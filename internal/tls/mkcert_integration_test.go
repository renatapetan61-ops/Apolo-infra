package tls

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestMkcertHostTrustIntegration(t *testing.T){
	if os.Getenv("APOLO_RUN_MKCERT_INTEGRATION")!="1"{t.Skip("set APOLO_RUN_MKCERT_INTEGRATION=1 after installing the local CA")}
	result,err:=Generate(context.Background(),"mkcert",filepath.Join(t.TempDir(),"certs"),"apolo-infra.test",false)
	if err!=nil{t.Fatal(err)}
	if !result.TrustedByHost{t.Fatal("generated certificate is not trusted by the host system trust store")}
	if err=VerifyHostTrust(result.Certificate,"apolo-infra.test");err!=nil{t.Fatal(err)}
}
