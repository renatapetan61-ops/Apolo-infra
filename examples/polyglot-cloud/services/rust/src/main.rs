use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use std::net::SocketAddr;

async fn root() -> Json<Value> {
    Json(json!({
        "service": "rust",
        "runtime": "Rust",
        "message": "APOLO Polyglot Cloud is running"
    }))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "rust" }))
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(root))
        .route("/healthz", get(health));
    let addr = SocketAddr::from(([0, 0, 0, 0], 8101));
    println!("Rust service listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind Rust service");
    axum::serve(listener, app).await.expect("serve Rust service");
}
