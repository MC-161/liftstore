package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	enginev1 "github.com/MC-161/liftstore/gen/engine/v1"
	"github.com/MC-161/liftstore/internal/httpapi"
)

func main() {
	engineAddr := flag.String("engine", "localhost:50051", "C++ engine gRPC address")
	listenAddr := flag.String("listen", ":8080", "HTTP listen address")
	corsOrigin := flag.String("cors-origin", "http://localhost:5173", "allowed browser origin")
	flag.Parse()

	// NewClient is lazy: it does not connect here. A dead engine surfaces on the
	// first request as Unavailable, not at startup -- unlike the C++ server, which
	// loads the store before it listens.
	conn, err := grpc.NewClient(*engineAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("engine client %s: %v", *engineAddr, err)
	}
	defer conn.Close()

	srv := &http.Server{
		Addr:              *listenAddr,
		Handler:           httpapi.NewRouter(enginev1.NewEngineClient(conn), *corsOrigin),
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
	}

	go func() {
		log.Printf("listening on %s, engine at %s", *listenAddr, *engineAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}