package proxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
)

const serverTemplate = `server {
    listen {{.Port}};
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

type Nginx struct { Binary, ConfigDir string }
func (n Nginx) Write(name,host string,port,target int) (string,error) {
	if n.ConfigDir=="" || n.Binary=="" { return "",errors.New("nginx binary and config directory are required") }
	if strings.ContainsAny(name+host,"/\\\n\r{};") || port<1||port>65535||target<1||target>65535 { return "",errors.New("invalid nginx configuration values") }
	t,err:=template.New("server").Parse(serverTemplate);if err!=nil{return "",err}
	var b bytes.Buffer;if err=t.Execute(&b,map[string]any{"Host":host,"Port":port,"TargetPort":target});err!=nil{return "",err}
	if err=os.MkdirAll(n.ConfigDir,0750);err!=nil{return "",err}
	path:=filepath.Join(n.ConfigDir,name+".conf"); tmp:=path+".tmp"
	if err=os.WriteFile(tmp,b.Bytes(),0640);err!=nil{return "",err}
	if err=os.Rename(tmp,path);err!=nil{_ = os.Remove(tmp);return "",err}
	return path,nil
}
func (n Nginx) ValidateAndReload(ctx context.Context) error {
	if n.Binary=="" { return errors.New("nginx binary is required") }
	if out,err:=exec.CommandContext(ctx,n.Binary,"-t").CombinedOutput();err!=nil{return fmt.Errorf("nginx config validation: %w: %s",err,strings.TrimSpace(string(out)))}
	if out,err:=exec.CommandContext(ctx,n.Binary,"-s","reload").CombinedOutput();err!=nil{return fmt.Errorf("nginx reload: %w: %s",err,strings.TrimSpace(string(out)))}
	return nil
}
