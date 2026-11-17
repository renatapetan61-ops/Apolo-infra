package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/renatapetan61-ops/Apolo-infra/internal/ports"
	"github.com/renatapetan61-ops/Apolo-infra/internal/runtime"
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

type Server struct { Store *store.Store; StartedAt time.Time; Ports ports.Allocator; Engine runtime.Engine }
type healthResponse struct { Status string `json:"status"`; Service string `json:"service"`; StartedAt time.Time `json:"started_at"`; Database string `json:"database"` }
type createRequest struct { Name string `json:"name"`; Image string `json:"image"`; ContainerPort int `json:"container_port"` }
type infrastructure struct { ID string `json:"id"`; Name string `json:"name"`; Image string `json:"image"`; Engine string `json:"engine"`; ContainerID string `json:"container_id"`; PublicPort int `json:"public_port"`; ContainerPort int `json:"container_port"`; Status string `json:"status"` }
var safeID=regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$`)

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
	id:=in.Name
	if _,err:=s.Store.DB.ExecContext(r.Context(),`INSERT INTO infrastructures(id,name,image,internal_port,status) VALUES(?,?,?,?,'created')`,id,in.Name,in.Image,in.ContainerPort);err!=nil{writeJSON(w,409,map[string]string{"error":"infrastructure already exists or database constraint failed"});return}
	port,err:=s.Ports.ReserveFor(r.Context(),id,"public")
	if err!=nil{_,_=s.Store.DB.ExecContext(r.Context(),`DELETE FROM infrastructures WHERE id=?`,id);writeJSON(w,503,map[string]string{"error":"unable to reserve public port"});return}
	_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET public_port=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,port,id)
	s.getInfrastructureByID(w,r,id,201)
}
func (s *Server) listInfrastructures(w http.ResponseWriter,r *http.Request){
	rows,err:=s.Store.DB.QueryContext(r.Context(),`SELECT id,name,image,engine,container_id,public_port,internal_port,status FROM infrastructures ORDER BY created_at DESC`);if err!=nil{writeJSON(w,500,map[string]string{"error":"database query failed"});return};defer rows.Close()
	items:=[]infrastructure{};for rows.Next(){var x infrastructure;if err:=rows.Scan(&x.ID,&x.Name,&x.Image,&x.Engine,&x.ContainerID,&x.PublicPort,&x.ContainerPort,&x.Status);err!=nil{writeJSON(w,500,map[string]string{"error":"database scan failed"});return};items=append(items,x)}
	writeJSON(w,200,items)
}
func (s *Server) getInfrastructure(w http.ResponseWriter,r *http.Request){s.getInfrastructureByID(w,r,r.PathValue("id"),200)}
func (s *Server) getInfrastructureByID(w http.ResponseWriter,r *http.Request,id string,status int){
	var x infrastructure;err:=s.Store.DB.QueryRowContext(r.Context(),`SELECT id,name,image,engine,container_id,public_port,internal_port,status FROM infrastructures WHERE id=?`,id).Scan(&x.ID,&x.Name,&x.Image,&x.Engine,&x.ContainerID,&x.PublicPort,&x.ContainerPort,&x.Status)
	if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return};writeJSON(w,status,x)
}
func (s *Server) startInfrastructure(w http.ResponseWriter,r *http.Request){
	if s.Engine==nil{writeJSON(w,503,map[string]string{"error":"Docker/Podman engine unavailable on this host"});return}
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return}
	if x.ContainerID==""{cid,err:=s.Engine.Create(r.Context(),x.Name,x.Image,map[int]int{x.PublicPort:x.ContainerPort});if err!=nil{writeJSON(w,502,map[string]string{"error":"container creation failed"});return};x.ContainerID=cid;_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET container_id=?,engine=?,status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?`,cid,s.Engine.Name(),x.ID)}
	if err=s.Engine.Start(r.Context(),x.ContainerID);err!=nil{writeJSON(w,502,map[string]string{"error":"container start failed"});return}
	_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?`,x.ID);s.getInfrastructureByID(w,r,x.ID,200)
}
func (s *Server) stopInfrastructure(w http.ResponseWriter,r *http.Request){
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return};if x.ContainerID==""||s.Engine==nil{writeJSON(w,409,map[string]string{"error":"infrastructure has no managed container"});return}
	if err=s.Engine.Stop(r.Context(),x.ContainerID);err!=nil{writeJSON(w,502,map[string]string{"error":"container stop failed"});return};_,_=s.Store.DB.ExecContext(r.Context(),`UPDATE infrastructures SET status='stopped',updated_at=CURRENT_TIMESTAMP WHERE id=?`,x.ID);s.getInfrastructureByID(w,r,x.ID,200)
}
func (s *Server) deleteInfrastructure(w http.ResponseWriter,r *http.Request){
	x,err:=s.load(r,r.PathValue("id"));if err!=nil{writeJSON(w,404,map[string]string{"error":"infrastructure not found"});return}
	if x.ContainerID!=""&&s.Engine!=nil{if err=s.Engine.Remove(r.Context(),x.ContainerID);err!=nil{writeJSON(w,502,map[string]string{"error":"container removal failed"});return}}
	_,err=s.Store.DB.ExecContext(r.Context(),`DELETE FROM infrastructures WHERE id=?`,x.ID);if err!=nil{writeJSON(w,500,map[string]string{"error":"database delete failed"});return};writeJSON(w,200,map[string]string{"status":"deleted","id":x.ID})
}
func (s *Server) load(r *http.Request,id string)(infrastructure,error){
	var x infrastructure;err:=s.Store.DB.QueryRowContext(r.Context(),`SELECT id,name,image,engine,container_id,public_port,internal_port,status FROM infrastructures WHERE id=?`,id).Scan(&x.ID,&x.Name,&x.Image,&x.Engine,&x.ContainerID,&x.PublicPort,&x.ContainerPort,&x.Status);return x,err
}
func securityHeaders(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("Cache-Control","no-store");next.ServeHTTP(w,r)})}
func writeJSON(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json; charset=utf-8");w.WriteHeader(status);_=json.NewEncoder(w).Encode(v)}
