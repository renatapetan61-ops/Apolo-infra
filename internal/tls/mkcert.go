package tls

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

type Result struct {
	Certificate string `json:"certificate"`
	Key string `json:"key"`
	TrustInstalled bool `json:"trust_installed"`
	TrustedByHost bool `json:"trusted_by_host"`
}
var validHostname=regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$`)

// Generate creates a local certificate. Installing mkcert's local CA modifies
// the host trust store and is therefore opt-in.
func Generate(ctx context.Context,binary,dir,host string,installTrust bool)(Result,error){
	if binary==""{binary="mkcert"}
	if !validHostname.MatchString(host)||strings.Contains(host,".."){return Result{},errors.New("invalid certificate hostname")}
	if err:=os.MkdirAll(dir,0700);err!=nil{return Result{},err}
	if out,err:=exec.CommandContext(ctx,binary,"-version").CombinedOutput();err!=nil{return Result{},fmt.Errorf("mkcert unavailable: %w: %s",err,strings.TrimSpace(string(out)))}
	if installTrust {
		if out,err:=exec.CommandContext(ctx,binary,"-install").CombinedOutput();err!=nil{return Result{},fmt.Errorf("mkcert trust installation: %w: %s",err,strings.TrimSpace(string(out)))}
	}
	cert:=filepath.Join(dir,host+".pem");key:=filepath.Join(dir,host+"-key.pem")
	if out,err:=exec.CommandContext(ctx,binary,"-cert-file",cert,"-key-file",key,host).CombinedOutput();err!=nil{return Result{},fmt.Errorf("mkcert generate: %w: %s",err,strings.TrimSpace(string(out)))}
	result:=Result{Certificate:cert,Key:key,TrustInstalled:installTrust}
	if err:=VerifyHostTrust(cert,host);err==nil {
		result.TrustedByHost=true
	} else if installTrust {
		return result,fmt.Errorf("certificate generated but host trust verification failed: %w",err)
	}
	return result,nil
}

// VerifyHostTrust verifies both the hostname and the chain against the host's
// system trust store, not merely against mkcert's private root CA file.
func VerifyHostTrust(certPath,host string)error{
	pemBytes,err:=os.ReadFile(certPath);if err!=nil{return err}
	block,_:=pem.Decode(pemBytes);if block==nil{return errors.New("certificate PEM is invalid")}
	leaf,err:=x509.ParseCertificate(block.Bytes);if err!=nil{return err}
	roots,err:=x509.SystemCertPool();if err!=nil{return fmt.Errorf("load host trust store: %w",err)}
	if roots==nil{return errors.New("host system trust store is unavailable")}
	_,err=leaf.Verify(x509.VerifyOptions{DNSName:host,Roots:roots})
	if err!=nil{return fmt.Errorf("certificate is not trusted by host system store: %w",err)}
	return nil
}
