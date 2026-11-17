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
	"github.com/renatapetan61-ops/Apolo-infra/internal/runtime"
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

type fakeEngine struct{ removed bool; started bool }
func(f *fakeEngine)Name()string{return "fake"}
func(f *fakeEngine)Create(context.Context,string,string,map[int]int)(string,error){return "container-123",nil}
func(f *fakeEngine)Start(context.Context,string)error{f.started=true;return nil}
func(f *fakeEngine)Stop(context.Context,string)error{f.started=false;return nil}
func(f *fakeEngine)Remove(context.Context,string)error{f.removed=true;return nil}
func(f *fakeEngine)Inspect(context.Context,string)(runtime.Container,error){return runtime.Container{},nil}

func TestInfrastructureLifecycleAppliesAndRemovesNginx(t *testing.T){
	db,err:=store.Open(context.Background(),filepath.Join(t.TempDir(),"lifecycle.db"));if err!=nil{t.Fatal(err)};defer db.Close()
	bin:=filepath.Join(t.TempDir(),"nginx");if err=os.WriteFile(bin,[]byte("#!/bin/sh\nexit 0\n"),0700);err!=nil{t.Fatal(err)}
	configDir:=t.TempDir();engine:=&fakeEngine{}
	s:=&Server{Store:db,StartedAt:time.Now(),Ports:ports.Allocator{DB:db.DB,Min:25100,Max:25110},Engine:engine,Nginx:&proxy.Nginx{Binary:bin,ConfigDir:configDir}}
	h:=s.Handler()
	create:=httptest.NewRequest("POST","/api/v1/infrastructures",strings.NewReader(`{"name":"demo-app","image":"nginx:alpine","container_port":80,"hostname":"demo-app.test"}`))
	created:=httptest.NewRecorder();h.ServeHTTP(created,create);if created.Code!=201{t.Fatalf("create status=%d body=%s",created.Code,created.Body.String())}
	start:=httptest.NewRequest("POST","/api/v1/infrastructures/demo-app/start",nil);started:=httptest.NewRecorder();h.ServeHTTP(started,start)
	if started.Code!=200{t.Fatalf("start status=%d body=%s",started.Code,started.Body.String())};if !engine.started{t.Fatal("engine did not start")}
	vhost:=filepath.Join(configDir,"demo-app.conf");data,err:=os.ReadFile(vhost);if err!=nil{t.Fatal(err)};if !strings.Contains(string(data),"demo-app.test"){t.Fatalf("hostname missing from vhost: %s",data)}
	del:=httptest.NewRequest("DELETE","/api/v1/infrastructures/demo-app",nil);deleted:=httptest.NewRecorder();h.ServeHTTP(deleted,del)
	if deleted.Code!=200{t.Fatalf("delete status=%d body=%s",deleted.Code,deleted.Body.String())};if !engine.removed{t.Fatal("container was not removed")}
	if _,err=os.Stat(vhost);!os.IsNotExist(err){t.Fatalf("nginx vhost was not deleted: %v",err)}
	var count int;if err=db.DB.QueryRow(`SELECT COUNT(*) FROM port_reservations WHERE infrastructure_id='demo-app'`).Scan(&count);err!=nil{t.Fatal(err)};if count!=0{t.Fatalf("port reservations remain after delete: %d",count)}
}
