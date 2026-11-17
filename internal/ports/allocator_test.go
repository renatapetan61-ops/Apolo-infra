package ports

import (
 "context"
 "path/filepath"
 "testing"

 "github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func TestReserveAndRelease(t *testing.T) { s,err:=store.Open(context.Background(),filepath.Join(t.TempDir(),"ports.db")); if err!=nil { t.Fatal(err) }; defer s.Close(); a:=Allocator{DB:s.DB,Min:24000,Max:24010}; p1,err:=a.Reserve(context.Background(),"public"); if err!=nil { t.Fatal(err) }; p2,err:=a.Reserve(context.Background(),"internal"); if err!=nil { t.Fatal(err) }; if p1==p2 { t.Fatalf("duplicate reservation: %d",p1) }; if err:=a.Release(context.Background(),p1); err!=nil { t.Fatal(err) }; p3,err:=a.Reserve(context.Background(),"replacement"); if err!=nil { t.Fatal(err) }; if p3!=p1 { t.Fatalf("released first port should be reused: got %d want %d",p3,p1) } }
