package proxy

import (
	"context"
	"os"
	"testing"
)

func TestNginxRealValidateReloadAndRemove(t *testing.T){
	if os.Getenv("APOLO_RUN_NGINX_INTEGRATION")!="1"{t.Skip("set APOLO_RUN_NGINX_INTEGRATION=1 with a running nginx master")}
	n:=Nginx{Binary:os.Getenv("APOLO_NGINX_BINARY"),ConfigDir:os.Getenv("APOLO_NGINX_CONFIG_DIR")}
	if n.Binary==""{n.Binary="nginx"};if n.ConfigDir==""{n.ConfigDir="/etc/nginx/conf.d"}
	if _,err:=n.Apply(context.Background(),"apolo-ci-check","apolo-ci-check.test",28081,nil);err!=nil{t.Fatal(err)}
	if err:=n.Remove(context.Background(),"apolo-ci-check");err!=nil{t.Fatal(err)}
}
