package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/renatapetan61-ops/Apolo-infra/internal/ports"
	"github.com/renatapetan61-ops/Apolo-infra/internal/proxy"
	"github.com/renatapetan61-ops/Apolo-infra/internal/runtime"
	localTLS "github.com/renatapetan61-ops/Apolo-infra/internal/tls"
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

type Server struct {
	Store *store.Store
	StartedAt time.Time
	Ports ports.Allocator
	Engine runtime.Engine
	Nginx *proxy.Nginx
	MkcertBinary string
	TLSDir string
	InstallLocalCA bool
}
type healthResponse struct { Status string `json:"status"`; Service string `json:"service"`; StartedAt time.Time `json:"started_at"`; Database string `json:"database"` }
type createRequest struct { Name string `json:"name"`; Image string `json:"image"`; ContainerPort int `json:"container_port"`; Hostname string `json:"hostname,omitempty"`; HTTPS bool `json:"https,omitempty"` }
type infrastructure struct {
	ID string `json:"id"`; Name string `json:"name"`; Image string `json:"image"`; Engine string `json:"engine"`; ContainerID string `json:"container_id"`
	PublicPort int `json:"public_port"`; ContainerPort int `json:"container_port"`; Status string `json:"status"`
	Hostname string `json:"hostname,omitempty"`; HTTPS bool `json:"https"`; Certificate string `json:"certificate,omitempty"`; NginxConfig string `json:"nginx_config,omitempty"`; privateKey string
}
var safeID=regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$`)
var safeHostname=regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$`)

func (s *Server) Handler() http.Handler {
	mux:=http.NewServeMux()
	mux.HandleFunc("GET /healthz",func(w http.ResponseWriter,r *http.Request){writeJSON(w,200,map[string]string{"status":"ok","service":"apolo-infra-daemon"})})
	mux.HandleFunc("GET /readyz",func(w http.ResponseWriter,r *http.Request){if err:=s.Store.DB.PingContext(r.Context());err!=nil{writeJSON(w,503,map[string]string{"status":"not_ready","database":"unavailable"});return};writeJSON(w,200,healthResponse{Status:"ready",Service:"apolo-infra-daemon",StartedAt:s.StartedAt,Database:"ok"})})
	mux.HandleFunc("POST /api/v1/infrastructures",s.createInfrastructure)
	mux.HandleFunc("GET /api/v1/infrastructures",s.listInfrastructures)
	mux.HandleFunc("GET /api/v1/infrastructures/{id}",s.getInfrastructure)
	mux.HandleFunc("POST /api/v1/infrastructures/{id}/start",s.startInfrastructure)
	mux.HandleFunc("POST /api/v1/infrastructures/{id}/stop",s.stopInfrastructure)
	mux.HandleFunc("DELETE /api/v1/infrastructures/{id}",s.deleteInfrastructure)
	return securityHeaders(mux)
}
func (s *Server) createInfrastructure(w http.ResponseWriter,r *http.Request){
	var in createRequest;d:=json.NewDecoder(http.MaxBytesReader(w,r.Body,1<<20));d.DisallowUnknownFields()
	if err:=d.Decode(&in);err!=nil{writeJSON(w,400,map[string]string{"error":"invalid JSON request"});return}
	if !safeID.MatchString(in.Name)||in.Image==""||in.ContainerPort<1||in.ContainerPort>65535{writeJSON(w,400,map[string]string{"error":"name must be 3-63 safe characters; image and valid container_port are required"});return}
	if in.HTTPS&&in.Hostname==""{writeJSON(w,400,map[string]string{"error":"hostname is required when https is enabled"});return}
	if in.Hostname!=""&&(!safeHostname.MatchString(in.Hostname)||containsDotDot(in.Hostname)){writeJSON(w,400,map[string]string{"error":"invalid hostname"});return}
	if in.Hostname!=""&&s.Nginx==nil{writeJSON(w,503,map[string]string{"error":"nginx integration is not configured"});return}
	if in.HTTPS&&s.TLSDir==""{writeJSON(w,503,map[string]string{"error":"local TLS is not configured"});return}
	id:=in.Name
	if _,err:=s.Store.DB.ExecContext(r.Context(),`INSERT INTO infrastructures(id,name,image,internal_port,status,hostname,https_enabled) VALUES(?,?,?,?,'created',?,?)`,id,in.Name,in.Image,in.ContainerPort,in.Hostname,boolInt(in.HTTPS));err!=nil{writeJSON(w,409,map[string]string{"error":"infrastructure already exists or hostname is already assigned"});return}
	port,err:=s.Ports.ReserveFor(r.Context(),id,"public")
	if err!=nil{_,_=s.Store.DB.ExecContext(r.Context(),`DELETE FROM infrastructures WHERE id=?`,id);writeJSON(w,503,map[string]string{"error":"unable to reserve public port"});return}
	if _,err=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET public_port=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,port,id);err!=nil{_,_=s.Store.DB.ExecContext(r.Context(),`DELETE FROM infrastructures WHERE id=?`,id);writeJSON(w,500,map[string]string{"error":"unable to persist public port"});return}
	s.getInfrastructureByID(w,r,id,201)
}
func (s *Server) listInfrastructures(w http.ResponseWriter,r *http.Request){
	rows,err:=s.Store.DB.QueryContext(r.Context(),selectInfrastructure+` ORDER BY created_at DESC`);if err!=nil{writeJSON(w,500,map[string]string{"error":"database query failed"});return};defer rows.Close()
	items:=[]infrastructure{};for rows.Next(){x,err:=scanInfrastructure(rows);if err!=nil{writeJSON(w,500,map[string]string{"error":"database scan failed"});return};items=append(items,x)}
	if err:=rows.Err();err!=nil{writeJSON(w,500,map[string]string{"error":"database iteration failed"});return};writeJSON(w,200,items)
}
func (s *Server) getInfrastructure(w http.ResponseWriter,r *http.Request){s.getInfrastructureByID(w,r,r.PathValue("id"),200)}
const selectInfrastructure=`SELECT id,name,image,engine,container_id,public_port,internal_port,status,hostname,https_enabled,certificate_path,private_key_path,nginx_config_path FROM infrastructures`
type scanner interface{Scan(...any)error}
func scanInfrastructure(row scanner)(infrastructure,error){var x infrastructure;var https int;var key string;err:=row.Scan(&x.ID,&x.Name,&x.Image,&x.Engine,&x.ContainerID,&x.PublicPort,&x.ContainerPort,&x.Status,&x.Hostname,&https,&x.Certificate,&key,&x.NginxConfig);x.HTTPS=https==1;return x,err}
func (s *Server) getInfrastructureByID(w http.ResponseWriter,r *http.Request,id string,status int){
	x,err:=s.load(r,id);if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return};writeJSON(w,status,x)
}
func (s *Server) startInfrastructure(w http.ResponseWriter,r *http.Request){
	if s.Engine==nil{writeJSON(w,503,map[string]string{"error":"Docker/Podman engine unavailable on this host"});return}
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return}
	if x.ContainerID==""{cid,err:=s.Engine.Create(r.Context(),x.Name,x.Image,map[int]int{x.PublicPort:x.ContainerPort});if err!=nil{writeJSON(w,502,map[string]string{"error":"container creation failed"});return};x.ContainerID=cid;if _,err=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET container_id=?,engine=?,status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?`,cid,s.Engine.Name(),x.ID);err!=nil{_ = s.Engine.Remove(r.Context(),cid);writeJSON(w,500,map[string]string{"error":"unable to persist container identity"});return}}
	if err=s.Engine.Start(r.Context(),x.ContainerID);err!=nil{writeJSON(w,502,map[string]string{"error":"container start failed"});return}
	if x.Hostname!="" {
		if s.Nginx==nil{_ = s.Engine.Stop(r.Context(),x.ContainerID);writeJSON(w,503,map[string]string{"error":"nginx integration is not configured"});return}
		var tlsFiles *proxy.TLSFiles
		var certPath,keyPath string
		if x.HTTPS {
			if s.TLSDir==""{_ = s.Engine.Stop(r.Context(),x.ContainerID);writeJSON(w,503,map[string]string{"error":"TLS is not configured"});return}
			generated,e:=localTLS.Generate(r.Context(),s.MkcertBinary,s.TLSDir,x.Hostname,s.InstallLocalCA)
			if e!=nil{_ = s.Engine.Stop(r.Context(),x.ContainerID);writeJSON(w,502,map[string]string{"error":"mkcert provisioning or host trust verification failed"});return}
			certPath,keyPath=generated.Certificate,generated.Key
			tlsFiles=&proxy.TLSFiles{Certificate:certPath,Key:keyPath}
		}
		configPath,e:=s.Nginx.Apply(r.Context(),x.ID,x.Hostname,x.PublicPort,tlsFiles)
		if e!=nil{_ = s.Engine.Stop(r.Context(),x.ContainerID);writeJSON(w,502,map[string]string{"error":"nginx validation or safe reload failed"});return}
		_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET certificate_path=?,private_key_path=?,nginx_config_path=? WHERE id=?`,certPath,keyPath,configPath,x.ID)
	}
	_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?`,x.ID);s.getInfrastructureByID(w,r,x.ID,200)
}
func (s *Server) stopInfrastructure(w http.ResponseWriter,r *http.Request){
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return};if x.ContainerID==""||s.Engine==nil{writeJSON(w,409,map[string]string{"error":"infrastructure has no managed container"});return}
	if err=s.Engine.Stop(r.Context(),x.ContainerID);err!=nil{writeJSON(w,502,map[string]string{"error":"container stop failed"});return};_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET status='stopped',updated_at=CURRENT_TIMESTAMP WHERE id=?`,x.ID);s.getInfrastructureByID(w,r,x.ID,200)
}
func (s *Server) deleteInfrastructure(w http.ResponseWriter,r *http.Request){
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return}
	if x.NginxConfig!=""&&s.Nginx!=nil{if err=s.Nginx.Remove(r.Context(),x.ID);err!=nil{writeJSON(w,502,map[string]string{"error":"nginx config removal failed; existing route was restored"});return}}
	if x.ContainerID!="" {
		if s.Engine==nil{if x.Hostname!=""&&s.Nginx!=nil{var tf *proxy.TLSFiles;if x.HTTPS{tf=&proxy.TLSFiles{Certificate:x.Certificate,Key:x.privateKey}};_,_=s.Nginx.Apply(r.Context(),x.ID,x.Hostname,x.PublicPort,tf)};writeJSON(w,503,map[string]string{"error":"container engine unavailable; refusing to delete metadata"});return}
		if err=s.Engine.Remove(r.Context(),x.ContainerID);err!=nil{if x.Hostname!=""&&s.Nginx!=nil{var tf *proxy.TLSFiles;if x.HTTPS{tf=&proxy.TLSFiles{Certificate:x.Certificate,Key:x.privateKey}};_,_=s.Nginx.Apply(r.Context(),x.ID,x.Hostname,x.PublicPort,tf)};writeJSON(w,502,map[string]string{"error":"container removal failed; proxy route restoration was attempted"});return}
	}
	_,err=s.Store.DB.ExecContext(r.Context(),`DELETE FROM infrastructures WHERE id=?`,x.ID);if err!=nil{writeJSON(w,500,map[string]string{"error":"database delete failed"});return};writeJSON(w,200,map[string]string{"status":"deleted","id":x.ID})
}
func (s *Server) load(r *http.Request,id string)(infrastructure,error){
	row:=s.Store.DB.QueryRowContext(r.Context(),selectInfrastructure+` WHERE id=?`,id);x,err:=scanInfrastructure(row)
	if err==nil{var key string;err=s.Store.DB.QueryRowContext(r.Context(),`SELECT private_key_path FROM infrastructures WHERE id=?`,id).Scan(&key);x.privateKey=key}
	return x,err
}
func securityHeaders(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("Cache-Control","no-store");next.ServeHTTP(w,r)})}
func writeJSON(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json; charset=utf-8");w.WriteHeader(status);_=json.NewEncoder(w).Encode(v)}
func boolInt(v bool)int{if v{return 1};return 0}
func containsDotDot(v string)bool{return errors.Is(errors.New(v),errors.New(".."))||regexp.MustCompile(`\.\.`).MatchString(v)}
