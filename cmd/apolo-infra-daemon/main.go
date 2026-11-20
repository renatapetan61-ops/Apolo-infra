package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/renatapetan61-ops/Apolo-infra/internal/api"
	"github.com/renatapetan61-ops/Apolo-infra/internal/config"
	"github.com/renatapetan61-ops/Apolo-infra/internal/ports"
	"github.com/renatapetan61-ops/Apolo-infra/internal/proxy"
	"github.com/renatapetan61-ops/Apolo-infra/internal/runtime"
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func main() {
	logger:=slog.New(slog.NewJSONHandler(os.Stdout,nil))
	cfg,err:=config.Load();if err!=nil{logger.Error("invalid configuration","error",err);os.Exit(1)}
	if os.Getenv("APOLO_DATABASE_API_TOKEN")=="" { logger.Error("APOLO_DATABASE_API_TOKEN is required; refusing to expose an unauthenticated daemon"); os.Exit(1) }
	ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
	db,err:=store.Open(ctx,cfg.DBPath);if err!=nil{logger.Error("database initialization failed","error",err);os.Exit(1)};defer db.Close()
	engine,engineErr:=runtime.Detect(ctx);if engineErr!=nil{logger.Warn("container engine unavailable; API will remain in control-plane mode","error",engineErr)}else{logger.Info("container engine detected","engine",engine.Name())}
	var nginx *proxy.Nginx
	if cfg.NginxConfigDir!="" { nginx=&proxy.Nginx{Binary:cfg.NginxBinary,ConfigDir:cfg.NginxConfigDir}; logger.Info("nginx lifecycle integration enabled","config_dir",cfg.NginxConfigDir) }
	handler:=(&api.Server{Store:db,StartedAt:time.Now().UTC(),Ports:ports.Allocator{DB:db.DB,Min:cfg.PortMin,Max:cfg.PortMax},Engine:engine,Nginx:nginx,MkcertBinary:cfg.MkcertBinary,TLSDir:cfg.TLSDir,InstallLocalCA:cfg.InstallLocalCA,DatabaseToken:os.Getenv("APOLO_DATABASE_API_TOKEN")}).Handler()
	srv:=&http.Server{Addr:cfg.ListenAddr,Handler:handler,ReadHeaderTimeout:5*time.Second,IdleTimeout:60*time.Second}
	errCh:=make(chan error,1);go func(){logger.Info("Apolo Infra daemon listening","address",cfg.ListenAddr,"database",cfg.DBPath);errCh<-srv.ListenAndServe()}()
	select{case err:=<-errCh:if !errors.Is(err,http.ErrServerClosed){logger.Error("HTTP server failed","error",err);os.Exit(1)};case <-ctx.Done():shutdownCtx,cancel:=context.WithTimeout(context.Background(),10*time.Second);defer cancel();if err:=srv.Shutdown(shutdownCtx);err!=nil{logger.Error("graceful shutdown failed","error",err)}}
}
