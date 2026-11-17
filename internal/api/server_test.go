package api

import (
 "context"
 "net/http/httptest"
 "path/filepath"
 "testing"
 "time"

 "github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func TestHealthAndReady(t *testing.T) { s,err:=store.Open(context.Background(),filepath.Join(t.TempDir(),"api.db")); if err!=nil { t.Fatal(err) }; defer s.Close(); h:=(&Server{Store:s,StartedAt:time.Now()}).Handler(); for _,path:=range []string{"/healthz","/readyz"} { rr:=httptest.NewRecorder(); h.ServeHTTP(rr,httptest.NewRequest("GET",path,nil)); if rr.Code!=200 { t.Fatalf("%s status=%d body=%s",path,rr.Code,rr.Body.String()) } } }
