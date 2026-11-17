package proxy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeNginx(t *testing.T,failMarker string) string {
	t.Helper()
	bin:=filepath.Join(t.TempDir(),"nginx")
	script:="#!/bin/sh\nif [ \"$1\" = \"-t\" ] && [ -f \""+failMarker+"\" ]; then echo invalid-config >&2; exit 1; fi\nexit 0\n"
	if err:=os.WriteFile(bin,[]byte(script),0700);err!=nil{t.Fatal(err)}
	return bin
}
func TestApplyHTTPSThenRemove(t *testing.T){
	dir:=t.TempDir();n:=Nginx{Binary:fakeNginx(t,filepath.Join(t.TempDir(),"fail")),ConfigDir:dir}
	path,err:=n.Apply(context.Background(),"app-one","app-one.test",23000,&TLSFiles{Certificate:"/tmp/app-one.pem",Key:"/tmp/app-one-key.pem"})
	if err!=nil{t.Fatal(err)}
	data,err:=os.ReadFile(path);if err!=nil{t.Fatal(err)}
	for _,want:=range []string{"listen 443 ssl","return 301 https://","ssl_certificate /tmp/app-one.pem","proxy_pass http://127.0.0.1:23000"}{if !strings.Contains(string(data),want){t.Fatalf("missing %q in vhost: %s",want,data)}}
	if err=n.Remove(context.Background(),"app-one");err!=nil{t.Fatal(err)}
	if _,err=os.Stat(path);!os.IsNotExist(err){t.Fatalf("vhost still exists: %v",err)}
}
func TestApplyRestoresPreviousConfigOnValidationFailure(t *testing.T){
	dir:=t.TempDir();marker:=filepath.Join(t.TempDir(),"fail");n:=Nginx{Binary:fakeNginx(t,marker),ConfigDir:dir}
	path,err:=n.Apply(context.Background(),"app-one","old.test",23000,nil);if err!=nil{t.Fatal(err)}
	before,err:=os.ReadFile(path);if err!=nil{t.Fatal(err)}
	if err=os.WriteFile(marker,[]byte("fail"),0600);err!=nil{t.Fatal(err)}
	if _,err=n.Apply(context.Background(),"app-one","new.test",23001,nil);err==nil{t.Fatal("expected nginx validation failure")}
	after,err:=os.ReadFile(path);if err!=nil{t.Fatal(err)}
	if string(after)!=string(before){t.Fatalf("old config was not restored: %s",after)}
}
func TestRejectUnsafeHostAndSite(t *testing.T){
	n:=Nginx{Binary:"nginx",ConfigDir:t.TempDir()}
	if _,err:=n.Apply(context.Background(),"../bad","good.test",23000,nil);err==nil{t.Fatal("unsafe site name accepted")}
	if _,err:=n.Apply(context.Background(),"good","bad..test",23000,nil);err==nil{t.Fatal("unsafe hostname accepted")}
}
