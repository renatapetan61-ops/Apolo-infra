package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("no supported container engine found")

type Container struct {
	ID string `json:"id"`
	Name string `json:"name"`
	Image string `json:"image"`
	State string `json:"state"`
	Addresses []string `json:"addresses,omitempty"`
}

type Engine interface {
	Name() string
	Create(context.Context, string, string, map[int]int) (string, error)
	Start(context.Context, string) error
	Stop(context.Context, string) error
	Remove(context.Context, string) error
	Inspect(context.Context, string) (Container, error)
}

type CLI struct { Binary string; EngineName string; Timeout time.Duration }

func Detect(ctx context.Context) (*CLI, error) {
	for _, candidate := range []struct{ bin, name string }{{"docker","docker"},{"podman","podman"}} {
		path, err := exec.LookPath(candidate.bin); if err != nil { continue }
		c := &CLI{Binary:path, EngineName:candidate.name, Timeout:2*time.Minute}
		if _, err := c.run(ctx,"info","--format","{{.Host.Arch}}"); err == nil { return c,nil }
	}
	return nil, ErrUnavailable
}
func (c *CLI) Name() string { return c.EngineName }
func (c *CLI) run(ctx context.Context, args ...string) ([]byte,error) {
	if c.Binary=="" { return nil,ErrUnavailable }
	timeout:=c.Timeout; if timeout<=0 { timeout=2*time.Minute }
	ctx,cancel:=context.WithTimeout(ctx,timeout); defer cancel()
	cmd:=exec.CommandContext(ctx,c.Binary,args...)
	out,err:=cmd.CombinedOutput()
	if err!=nil { return nil,fmt.Errorf("%s %s: %w: %s",c.EngineName,strings.Join(args," "),err,strings.TrimSpace(string(out))) }
	return out,nil
}
func (c *CLI) Create(ctx context.Context,name,image string,ports map[int]int)(string,error) {
	if strings.TrimSpace(name)=="" || strings.TrimSpace(image)=="" { return "",errors.New("container name and image are required") }
	args:=[]string{"create","--name",name,"--restart","unless-stopped"}
	for host,container:=range ports { if host<1||host>65535||container<1||container>65535{return "",errors.New("invalid port mapping")}; args=append(args,"-p",fmt.Sprintf("127.0.0.1:%d:%d",host,container)) }
	args=append(args,image)
	out,err:=c.run(ctx,args...); return strings.TrimSpace(string(out)),err
}
func (c *CLI) Start(ctx context.Context,id string) error { _,err:=c.run(ctx,"start",id); return err }
func (c *CLI) Stop(ctx context.Context,id string) error { _,err:=c.run(ctx,"stop","--time","10",id); return err }
func (c *CLI) Remove(ctx context.Context,id string) error { _,err:=c.run(ctx,"rm","--force",id); return err }
func (c *CLI) Inspect(ctx context.Context,id string)(Container,error) {
	out,err:=c.run(ctx,"inspect",id); if err!=nil{return Container{},err}
	var rows []struct{ ID string `json:"Id"`; Name string `json:"Name"`; Config struct{ Image string `json:"Image"` } `json:"Config"`; State struct{ Status string `json:"Status"` } `json:"State"` }
	if err:=json.Unmarshal(out,&rows);err!=nil{return Container{},err}; if len(rows)==0{return Container{},errors.New("container not found")}
	return Container{ID:rows[0].ID,Name:strings.TrimPrefix(rows[0].Name,"/"),Image:rows[0].Config.Image,State:rows[0].State.Status},nil
}
