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
	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load(); if err != nil { logger.Error("invalid configuration", "error", err); os.Exit(1) }
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM); defer stop()
	db, err := store.Open(ctx, cfg.DBPath); if err != nil { logger.Error("database initialization failed", "error", err); os.Exit(1) }; defer db.Close()
	srv := &http.Server{Addr:cfg.ListenAddr, Handler:(&api.Server{Store:db, StartedAt:time.Now().UTC()}).Handler(), ReadHeaderTimeout:5*time.Second, IdleTimeout:60*time.Second}
	errCh := make(chan error,1); go func(){ logger.Info("Apolo Infra daemon listening", "address", cfg.ListenAddr, "database", cfg.DBPath); errCh <- srv.ListenAndServe() }()
	select { case err := <-errCh: if !errors.Is(err,http.ErrServerClosed) { logger.Error("HTTP server failed", "error",err); os.Exit(1) }; case <-ctx.Done(): shutdownCtx,cancel:=context.WithTimeout(context.Background(),10*time.Second); defer cancel(); if err:=srv.Shutdown(shutdownCtx); err!=nil { logger.Error("graceful shutdown failed", "error",err) } }
}
