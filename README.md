# APOLO INFRA

Plataforma modular de hospedagem e orquestração de infraestruturas de software, com execução real no host autorizado.

> Estado atual: fundação da Etapa 1 em implementação. Recursos só serão marcados como disponíveis após implementação e testes reais.

## Arquitetura inicial

- `apps/web`: painel Next.js/React (etapa posterior).
- `cmd/apolo-infra-daemon`: processo local em Go.
- `internal/api`: API HTTP local e protegida.
- `internal/config`: configuração e validação.
- `internal/store`: SQLite e migrações.
- `internal/ports`: reserva transacional de portas.
- `internal/runtime`: contratos para Docker/Podman (integração executável em etapa posterior).
- `deploy/nginx`: templates e validação de proxy (etapa posterior).

## Estado das implementações (Etapas 1–3)

- Daemon Go e SQLite com migração de schema v2.
- Reservas TCP persistidas e associadas a uma infraestrutura; exclusão da infraestrutura libera a reserva via chave estrangeira.
- API REST para criar/listar/consultar/iniciar/parar/excluir infraestrutura.
- Adaptador real de linha de comando Docker/Podman (detecção, create/start/stop/rm/inspect).
- Gerador Nginx atômico com validação `nginx -t` antes do reload.
- Gerador de certificado local via mkcert, com instalação da CA explicitamente opcional.
- Aplicação de exemplo em `examples/hello`; CI executa build, start e requisição HTTP em Docker Engine.

Limites: o daemon ainda não autentica chamadas API; mantenha-o em `127.0.0.1`. Nginx/mkcert estão disponíveis como pacotes internos, mas ainda não são acionáveis pela API. Podman é detectado quando instalado, porém o smoke test automatizado atual usa Docker Engine. O teste de deploy real só será considerado aprovado após o job `Real Docker deployment smoke test` concluir com sucesso.

## Etapa 1 — Fundação do daemon

1. Inicializar daemon Go com encerramento gracioso.
2. Configuração explícita do endereço de bind; padrão `127.0.0.1`.
3. SQLite com migrações versionadas.
4. Reserva atômica de portas TCP no banco, com intervalo configurável.
5. API de saúde e consulta de estado.
6. Testes automatizados e CI.

## Requisitos

- Go 1.23 ou superior.
- SQLite via driver Go puro (sem dependência de CGO).

## Desenvolvimento

```bash
go test ./...
go run ./cmd/apolo-infra-daemon
```

Configuração por variáveis de ambiente:

- `APOLO_INFRA_LISTEN_ADDR` (padrão `127.0.0.1:8787`)
- `APOLO_INFRA_DB_PATH` (padrão `./data/apolo-infra.db`)
- `APOLO_INFRA_PORT_MIN` (padrão `20000`)
- `APOLO_INFRA_PORT_MAX` (padrão `29999`)

## Segurança

O daemon deve permanecer em loopback por padrão. Não exponha a API em `0.0.0.0` sem autenticação forte, TLS e regras de firewall. O daemon não executa comandos arbitrários enviados pela API. A integração com Docker/Podman exigirá validação de projetos, limites e isolamento.

## Limites operacionais

Hospedagem local só permanece disponível enquanto o host estiver ligado, conectado e com recursos suficientes. Um frontend remoto não ganha acesso ao Docker local sem um daemon instalado e explicitamente pareado.

## Licença

A definir.
