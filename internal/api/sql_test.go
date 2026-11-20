package api

import (
 "bytes"
 "context"
 "encoding/json"
 "net/http/httptest"
 "path/filepath"
 "testing"
 "time"

 "github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func TestSQLiteBridgeCRUDAndRecovery(t *testing.T) {
 path:=filepath.Join(t.TempDir(),"persistent.db")
 db,err:=store.Open(context.Background(),path); if err!=nil { t.Fatal(err) }
 server:=&Server{Store:db,StartedAt:time.Now(),DatabaseToken:"bridge-test-secret"}
 handler:=server.Handler()
 call:=func(statement string,args ...any) []map[string]any {
  t.Helper()
  payload,_:=json.Marshal(map[string]any{"statement":statement,"args":args})
  req:=httptest.NewRequest("POST","/internal/sql",bytes.NewReader(payload))
  req.Header.Set("Authorization","Bearer bridge-test-secret")
  req.Header.Set("Content-Type","application/json")
  res:=httptest.NewRecorder();handler.ServeHTTP(res,req)
  if res.Code!=200 { t.Fatalf("SQL bridge status=%d body=%s statement=%s",res.Code,res.Body.String(),statement) }
  var out struct{Rows []map[string]any `json:"rows"`}
  if err:=json.Unmarshal(res.Body.Bytes(),&out);err!=nil { t.Fatal(err) }
  return out.Rows
 }

 created:=call("INSERT INTO infrastructures(id,name,image,owner_id,internal_port,container_port,status) VALUES(?,?,?,?,?,?, 'queued') RETURNING id,name,status","infra-crud-001","crud-test","nginx:alpine","user-test",8080,8080)
 if len(created)!=1 || created[0]["id"]!="infra-crud-001" { t.Fatalf("create failed: %#v",created) }
 read:=call("SELECT id,name,status FROM infrastructures WHERE id=? AND owner_id=?","infra-crud-001","user-test")
 if len(read)!=1 || read[0]["name"]!="crud-test" { t.Fatalf("read failed: %#v",read) }
 updated:=call("UPDATE infrastructures SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING status","infra-crud-001")
 if len(updated)!=1 || updated[0]["status"]!="running" { t.Fatalf("update failed: %#v",updated) }

 if err=db.Close();err!=nil { t.Fatal(err) }
 db,err=store.Open(context.Background(),path);if err!=nil { t.Fatalf("reopen SQLite after simulated restart: %v",err) }
 server.Store=db;handler=server.Handler()
 recovered:=call("SELECT id,status FROM infrastructures WHERE id=?","infra-crud-001")
 if len(recovered)!=1 || recovered[0]["status"]!="running" { t.Fatalf("record was not recovered after restart: %#v",recovered) }
 deleted:=call("DELETE FROM infrastructures WHERE id=? RETURNING id","infra-crud-001")
 if len(deleted)!=1 { t.Fatalf("delete failed: %#v",deleted) }
 remaining:=call("SELECT id FROM infrastructures WHERE id=?","infra-crud-001")
 if len(remaining)!=0 { t.Fatalf("deleted record still exists: %#v",remaining) }
 if err=db.Close();err!=nil { t.Fatal(err) }
}

func TestSQLiteBridgeRejectsMissingToken(t *testing.T) {
 db,err:=store.Open(context.Background(),filepath.Join(t.TempDir(),"auth.db"));if err!=nil{t.Fatal(err)};defer db.Close()
 h:=(&Server{Store:db,DatabaseToken:"expected-secret"}).Handler()
 req:=httptest.NewRequest("POST","/internal/sql",bytes.NewBufferString("{\"statement\":\"SELECT 1\",\"args\":[]}"))
 res:=httptest.NewRecorder();h.ServeHTTP(res,req)
 if res.Code!=401 { t.Fatalf("expected 401 without token, got %d",res.Code) }
}
