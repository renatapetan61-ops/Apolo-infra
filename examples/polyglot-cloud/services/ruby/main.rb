require "webrick"
require "json"
require "time"

server = WEBrick::HTTPServer.new(
  Port: 8103,
  BindAddress: "0.0.0.0",
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

server.mount_proc "/" do |request, response|
  response["Content-Type"] = "application/json"
  response.body = JSON.generate({
    service: "ruby",
    runtime: "Ruby",
    message: "APOLO Polyglot Cloud is running",
    path: request.path,
    time: Time.now.utc.iso8601
  })
end

server.mount_proc "/healthz" do |_request, response|
  response["Content-Type"] = "application/json"
  response.body = JSON.generate({ status: "ok", service: "ruby" })
end

trap("INT") { server.shutdown }
trap("TERM") { server.shutdown }
puts "Ruby service listening on :8103"
server.start
