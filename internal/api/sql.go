package api

import (
 "database/sql"
 "encoding/json"
 "io"
 "net/http"
 "strings"
)

type sqlRequest struct {
 Statement string `json:"statement"`
 Args []any `json:"args"`
}

func (s *Server) executeSQL(w http.ResponseWriter,r *http.Request) {
 body,err:=io.ReadAll(http.MaxBytesReader(w,r.Body,256*1024))
 if err!=nil { writeJSON(w,http.StatusRequestEntityTooLarge,map[string]string{"error":"request too large"}); return }
 var input sqlRequest
 if err=json.Unmarshal(body,&input); err!=nil { writeJSON(w,http.StatusBadRequest,map[string]string{"error":"invalid SQL request"}); return }
 statement:=strings.TrimSpace(input.Statement)
 upper:=strings.ToUpper(statement)
 if statement=="" || len(statement)>32768 || strings.Contains(statement,";") ||
  !(strings.HasPrefix(upper,"SELECT ") || strings.HasPrefix(upper,"INSERT ") || strings.HasPrefix(upper,"UPDATE ") || strings.HasPrefix(upper,"DELETE ")) {
  writeJSON(w,http.StatusBadRequest,map[string]string{"error":"only one parameterized SELECT/INSERT/UPDATE/DELETE statement is allowed"}); return
 }
 if !strings.HasPrefix(upper,"SELECT ") && !strings.Contains(upper," RETURNING ") {
  if _,err=s.Store.DB.ExecContext(r.Context(),statement,input.Args...); err!=nil {
   writeJSON(w,http.StatusBadRequest,map[string]string{"error":"SQLite statement failed"}); return
  }
  writeJSON(w,http.StatusOK,map[string]any{"rows":[]any{}}); return
 }
 rows,err:=s.Store.DB.QueryContext(r.Context(),statement,input.Args...)
 if err!=nil { writeJSON(w,http.StatusBadRequest,map[string]string{"error":"SQLite statement failed"}); return }
 defer rows.Close()
 columns,err:=rows.Columns(); if err!=nil { writeJSON(w,http.StatusInternalServerError,map[string]string{"error":"SQLite column metadata failed"}); return }
 result:=make([]map[string]any,0)
 for rows.Next() {
  values:=make([]any,len(columns)); destinations:=make([]any,len(columns))
  for i:=range values { destinations[i]=&values[i] }
  if err=rows.Scan(destinations...); err!=nil { writeJSON(w,http.StatusInternalServerError,map[string]string{"error":"SQLite row scan failed"}); return }
  item:=make(map[string]any,len(columns))
  for i,name:=range columns {
   switch value:=values[i].(type) { case []byte: item[name]=string(value); case sql.RawBytes: item[name]=string(value); default: item[name]=value }
  }
  result=append(result,item)
  if len(result)>5000 { writeJSON(w,http.StatusRequestEntityTooLarge,map[string]string{"error":"result row limit exceeded"}); return }
 }
 if err=rows.Err(); err!=nil { writeJSON(w,http.StatusInternalServerError,map[string]string{"error":"SQLite result iteration failed"}); return }
 writeJSON(w,http.StatusOK,map[string]any{"rows":result})
}
