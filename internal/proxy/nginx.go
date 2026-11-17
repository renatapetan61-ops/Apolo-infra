package proxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
)

const httpTemplate = `server {
    listen 80;
    server_name {{.Host}};
    location / {
        proxy_pass http://127.0.0.1:{{.TargetPort}};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`
const httpsTemplate = `server {
    listen 80;
    server_name {{.Host}};
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name {{.Host}};
    ssl_certificate {{.Certificate}};
    ssl_certificate_key {{.Key}};
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {
        proxy_pass http://127.0.0.1:{{.TargetPort}};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`

type Nginx struct { Binary, ConfigDir string }
type TLSFiles struct { Certificate, Key string }

var validHost = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$`)
var validSite = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$`)

func (n Nginx) sitePath(name string) (string,error) {
	if n.ConfigDir=="" || n.Binary=="" { return "",errors.New("nginx binary and config directory are required") }
	if !validSite.MatchString(name) { return "",errors.New("invalid nginx site name") }
	return filepath.Join(n.ConfigDir,name+".conf"),nil
}

// Apply atomically replaces a vhost, validates the full nginx configuration,
// reloads nginx, and restores the previous file if validation/reload fails.
func (n Nginx) Apply(ctx context.Context,name,host string,targetPort int,tlsFiles *TLSFiles)(string,error) {
	path,err:=n.sitePath(name);if err!=nil{return "",err}
	if !validHost.MatchString(host)||strings.Contains(host,"..")||targetPort<1||targetPort>65535{return "",errors.New("invalid nginx host or target port")}
	data:=map[string]any{"Host":host,"TargetPort":targetPort}
	tmpl:=httpTemplate
	if tlsFiles!=nil {
		if tlsFiles.Certificate==""||tlsFiles.Key==""||strings.ContainsAny(tlsFiles.Certificate+tlsFiles.Key,"\n\r;{}"){return "",errors.New("invalid TLS certificate paths")}
		data["Certificate"]=tlsFiles.Certificate;data["Key"]=tlsFiles.Key;tmpl=httpsTemplate
	}
	t,err:=template.New("vhost").Parse(tmpl);if err!=nil{return "",err}
	var b bytes.Buffer;if err=t.Execute(&b,data);err!=nil{return "",err}
	if err=os.MkdirAll(n.ConfigDir,0750);err!=nil{return "",err}
	previous,readErr:=os.ReadFile(path);hadPrevious:=readErr==nil
	if readErr!=nil&&!errors.Is(readErr,os.ErrNotExist){return "",readErr}
	if err=atomicWrite(path,b.Bytes());err!=nil{return "",err}
	if err=n.ValidateAndReload(ctx);err!=nil {
		if hadPrevious { _=atomicWrite(path,previous) } else { _=os.Remove(path) }
		_ = n.ValidateAndReload(ctx)
		return "",err
	}
	return path,nil
}

// Remove deletes a vhost only if nginx accepts and reloads the resulting config.
// On failure the previous vhost is restored.
func (n Nginx) Remove(ctx context.Context,name string) error {
	path,err:=n.sitePath(name);if err!=nil{return err}
	previous,err:=os.ReadFile(path);if errors.Is(err,os.ErrNotExist){return nil};if err!=nil{return err}
	if err=os.Remove(path);err!=nil{return err}
	if err=n.ValidateAndReload(ctx);err!=nil {
		_ = atomicWrite(path,previous)
		_ = n.ValidateAndReload(ctx)
		return err
	}
	return nil
}
func atomicWrite(path string,data []byte)error{
	tmp:=path+".tmp"
	if err:=os.WriteFile(tmp,data,0640);err!=nil{return err}
	if err:=os.Rename(tmp,path);err!=nil{_ = os.Remove(tmp);return err}
	return nil
}
func (n Nginx) ValidateAndReload(ctx context.Context)error{
	if n.Binary==""{return errors.New("nginx binary is required")}
	if out,err:=exec.CommandContext(ctx,n.Binary,"-t").CombinedOutput();err!=nil{return fmt.Errorf("nginx config validation: %w: %s",err,strings.TrimSpace(string(out)))}
	if out,err:=exec.CommandContext(ctx,n.Binary,"-s","reload").CombinedOutput();err!=nil{return fmt.Errorf("nginx reload: %w: %s",err,strings.TrimSpace(string(out)))}
	return nil
}
