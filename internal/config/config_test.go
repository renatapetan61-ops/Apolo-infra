package config

import (
 "os"
 "testing"
)

func clearConfigEnv(t *testing.T) { t.Helper(); for _,k:=range []string{"APOLO_INFRA_LISTEN_ADDR","APOLO_INFRA_DB_PATH","APOLO_INFRA_PORT_MIN","APOLO_INFRA_PORT_MAX"} { t.Setenv(k,"") } }

func TestLoadDefaults(t *testing.T) { clearConfigEnv(t); c,err:=Load(); if err!=nil { t.Fatal(err) }; if c.ListenAddr!="127.0.0.1:8787" || c.PortMin!=20000 || c.PortMax!=29999 { t.Fatalf("unexpected defaults: %+v",c) } }
func TestLoadRejectsInvalidRange(t *testing.T) { clearConfigEnv(t); t.Setenv("APOLO_INFRA_PORT_MIN","30000"); t.Setenv("APOLO_INFRA_PORT_MAX","20000"); if _,err:=Load(); err==nil { t.Fatal("expected invalid range error") } }
func TestLoadRejectsInvalidAddress(t *testing.T) { clearConfigEnv(t); t.Setenv("APOLO_INFRA_LISTEN_ADDR","not-an-address"); if _,err:=Load(); err==nil { t.Fatal("expected invalid address error") }; _=os.Getenv("PATH") }
