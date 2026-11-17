package api

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/renatapetan61-ops/Apolo-infra/internal/ports"
	"github.com/renatapetan61-ops/Apolo-infra/internal/proxy"
	localTLS "github.com/renatapetan61-ops/Apolo-infra/internal/tls"
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func TestInfrastructureHTTPSLifecycleWithMkcert(t *testing.T){
	if os.Getenv("APOLO_RUN_MKCERT_INTEGRATION")!="1"{t.Skip("set APOLO_RUN_MKCERT_INTEGRATION=1 after installing the local CA")}
	db,err:=store.Open(context.Background(),filepath.Join(t.TempDir(),"https.db"));if err!=nil{t.Fatal(err)};defer db.Close()
	bin:=filepath.Join(t.TempDir(),"nginx");if err=os.WriteFile(bin,[]byte("#!/bin/sh\nexit 0\n"),0700);err!=nil{t.Fatal(err)}
	engine:=&fakeEngine{};dir:=t.TempDir()
	s:=&Server{Store:db,StartedAt:time.Now(),Ports:ports.Allocator{DB:db.DB,Min:25200,Max:25210},Engine:engine,Nginx:&proxy.Nginx{Binary:bin,ConfigDir:dir},MkcertBinary:"mkcert",TLSDir:filepath.Join(t.TempDir(),"certs")}
	h:=s.Handler()
	create:=httptest.NewRequest("POST","/api/v1/infrastructures",strings.NewReader(`{"name":"tls-app","image":"nginx:alpine","container_port":80,"hostname":"apolo-infra.test","https":true}`))
	created:=httptest.NewRecorder();h.ServeHTTP(created,create);if created.Code!=201{t.Fatalf("create status=%d body=%s",created.Code,created.Body.String())}
	start:=httptest.NewRequest("POST","/api/v1/infrastructures/tls-app/start",nil);started:=httptest.NewRecorder();h.ServeHTTP(started,start)
	if started.Code!=200{t.Fatalf("start status=%d body=%s",started.Code,started.Body.String())}
	var cert string;if err=db.DB.QueryRow(`SELECT certificate_path FROM infrastructures WHERE id='tls-app'`).Scan(&cert);err!=nil{t.Fatal(err)}
	if err=localTLS.VerifyHostTrust(cert,"apolo-infra.test");err!=nil{t.Fatalf("host trust verification failed: %v",err)}
	vhost,err:=os.ReadFile(filepath.Join(dir,"tls-app.conf"));if err!=nil{t.Fatal(err)}
	if !strings.Contains(string(vhost),"listen 443 ssl")||!strings.Contains(string(vhost),cert){t.Fatalf("HTTPS vhost is incomplete: %s",vhost)}
}
