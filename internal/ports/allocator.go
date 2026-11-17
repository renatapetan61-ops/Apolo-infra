package ports

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strconv"
)

type Allocator struct { DB *sql.DB; Min, Max int }

func (a Allocator) Reserve(ctx context.Context, purpose string) (int,error) { return a.ReserveFor(ctx,"",purpose) }

// ReserveFor binds the reservation to an existing infrastructure record.
func (a Allocator) ReserveFor(ctx context.Context, infrastructureID,purpose string) (int,error) {
	if a.DB==nil||a.Min<1024||a.Max>65535||a.Min>a.Max{return 0,fmt.Errorf("invalid port allocator configuration")}
	tx,err:=a.DB.BeginTx(ctx,nil);if err!=nil{return 0,err};defer tx.Rollback()
	for port:=a.Min;port<=a.Max;port++ {
		var exists int;err:=tx.QueryRowContext(ctx,`SELECT 1 FROM port_reservations WHERE port=?`,port).Scan(&exists)
		if err==nil{continue};if err!=sql.ErrNoRows{return 0,err}
		ln,err:=net.Listen("tcp",net.JoinHostPort("127.0.0.1",strconv.Itoa(port)));if err!=nil{continue};_ = ln.Close()
		_,err=tx.ExecContext(ctx,`INSERT INTO port_reservations(port,infrastructure_id,purpose) VALUES(?,?,?)`,port,nullIfEmpty(infrastructureID),purpose)
		if err!=nil{continue};if err=tx.Commit();err!=nil{return 0,err};return port,nil
	}
	return 0,fmt.Errorf("no available TCP ports in range %d-%d",a.Min,a.Max)
}
func nullIfEmpty(v string) any { if v==""{return nil};return v }
func (a Allocator) Release(ctx context.Context,port int)error{return a.ReleaseFor(ctx,"",port)}
func (a Allocator) ReleaseFor(ctx context.Context,infrastructureID string,port int)error{
	var res sql.Result;var err error
	if infrastructureID==""{res,err=a.DB.ExecContext(ctx,`DELETE FROM port_reservations WHERE port=?`,port)}else{res,err=a.DB.ExecContext(ctx,`DELETE FROM port_reservations WHERE port=? AND infrastructure_id=?`,port,infrastructureID)}
	if err!=nil{return err};n,err:=res.RowsAffected();if err!=nil{return err};if n==0{return fmt.Errorf("port %d is not reserved for requested infrastructure",port)};return nil
}
