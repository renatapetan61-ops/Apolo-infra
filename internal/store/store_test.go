package store

import (
 "context"
 "path/filepath"
 "testing"
)

func TestOpenCreatesSchema(t *testing.T) { s,err:=Open(context.Background(),filepath.Join(t.TempDir(),"state.db")); if err!=nil { t.Fatal(err) }; defer s.Close(); var version int; if err:=s.DB.QueryRow(`SELECT version FROM schema_migrations`).Scan(&version); err!=nil { t.Fatal(err) }; if version!=1 { t.Fatalf("schema version=%d, want 1",version) } }
