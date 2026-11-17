package tls

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Result struct { Certificate string `json:"certificate"`; Key string `json:"key"`; TrustInstalled bool `json:"trust_installed"` }

// Generate creates a local certificate. Trust installation is intentionally opt-in
// and requires mkcert's local CA to be installed on the host.
func Generate(ctx context.Context,binary,dir,host string,installTrust bool)(Result,error){
	if binary=="" { binary="mkcert" }
	if strings.TrimSpace(host)=="" || strings.ContainsAny(host,"/\\\n\r ") { return Result{},errors.New("invalid certificate hostname") }
	if err:=exec.CommandContext(ctx,binary,"-version").Run();err!=nil{return Result{},fmt.Errorf("mkcert unavailable: %w",err)}
	if err:=os.MkdirAll(dir,0700);err!=nil{return Result{},err}
	cert:=filepath.Join(dir,host+".pem"); key:=filepath.Join(dir,host+"-key.pem")
	if out,err:=exec.CommandContext(ctx,binary,"-cert-file",cert,"-key-file",key,host).CombinedOutput();err!=nil{return Result{},fmt.Errorf("mkcert generate: %w: %s",err,strings.TrimSpace(string(out)))}
	trusted:=false
	if installTrust { if out,err:=exec.CommandContext(ctx,binary,"-install").CombinedOutput();err!=nil{return Result{},fmt.Errorf("mkcert trust installation: %w: %s",err,strings.TrimSpace(string(out)))}; trusted=true }
	return Result{Certificate:cert,Key:key,TrustInstalled:trusted},nil
}
