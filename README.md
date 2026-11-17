# APOLO INFRA

Plataforma modular de hospedagem e orquestração de infraestruturas de software, com execução real no host autorizado.

Estado atual: integração de ciclo de vida implementada; os testes de CI cobrem o daemon, Nginx real, Docker, Podman e confiança da CA mkcert no host.

## Arquitetura atual

- `apps/web`: painel Next.js/React (etapa posterior).
- `cmd/apolo-infra-daemon`: processo local em Go.
- `internal/api`: API HTTP local e protegida.
- `internal/config`: configuração e validação.
- `internal/store`: SQLite e migrações.
- `internal/ports`: reserva transacional de portas.
- `internal/runtime`: adaptador executável Docker/Podman.
- `internal/proxy`: gerenciamento de vhosts Nginx com validação e reload seguros.
- `internal/tls`: provisionamento mkcert e verificação no trust store do host.

## Estado das implementações (Etapas 1–4)

- Daemon Go e SQLite com migração de schema v3.
- Reservas TCP persistidas e associadas a uma infraestrutura; exclusão da infraestrutura libera a reserva via chave estrangeira.
- API REST para criar/listar/consultar/iniciar/parar/excluir infraestrutura.
- Adaptador real de linha de comando Docker/Podman (detecção, create/start/stop/rm/inspect).
- Nginx integrado ao start/delete: vhost HTTP ou HTTPS, validação `nginx -t`, reload e restauração da configuração anterior em falha.
- mkcert integrado ao start HTTPS; a opção de instalar a CA no host é explícita e o código verifica a cadeia no trust store do sistema.
- Aplicação de exemplo em `examples/hello`; CI verifica deploy real em Docker e Podman, além da confiança do certificado no host.

Limites: o daemon ainda não autentica chamadas API; mantenha-o em `127.0.0.1`. Para usar hostnames, configure `APOLO_INFRA_NGINX_CONFIG_DIR` para um diretório incluído pelo Nginx (por exemplo, `/etc/nginx/conf.d`) e permita que o daemon grave nesse diretório e execute `nginx -t`/reload. O Nginx precisa estar ativo e escutando nas portas 80/443. Para HTTPS, configure `APOLO_INFRA_TLS_DIR`; `APOLO_INFRA_INSTALL_LOCAL_CA=true` instala a CA mkcert no trust store do host e só deve ser habilitado com autorização administrativa. Sem essa opção, o certificado é gerado, mas a confiança no host não é presumida. Nunca publique a chave privada. O CI executa deploys reais em Docker e Podman, testa Nginx em um processo real com `nginx -t` e reload, e instala a CA mkcert no trust store do runner para validar certificados por OpenSSL e Go. O teste de API HTTPS também executa a geração mkcert e verifica a confiança do certificado.

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

### Criar infraestrutura com domínio e HTTPS

`POST /api/v1/infrastructures` aceita `hostname` e `https` opcionais:

```json
{"name":"minha-app","image":"nginx:alpine","container_port":80,"hostname":"minha-app.test","https":true}
```

Ao iniciar, o daemon cria/inicia o contêiner, gera o certificado mkcert quando HTTPS está habilitado, grava o vhost e só o ativa depois de `nginx -t` e reload. Ao excluir, remove o vhost e recarrega o Nginx antes de remover os metadados. Se a remoção do contêiner falhar, tenta restaurar o vhost.

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
- `APOLO_INFRA_NGINX_BINARY` (padrão `nginx`)
- `APOLO_INFRA_NGINX_CONFIG_DIR` (vazio por padrão; habilita integração Nginx quando definido)
- `APOLO_INFRA_MKCERT_BINARY` (padrão `mkcert`)
- `APOLO_INFRA_TLS_DIR` (padrão `./data/certs`)
- `APOLO_INFRA_INSTALL_LOCAL_CA` (padrão `false`; instalar CA altera o trust store do host)

## Segurança

O daemon deve permanecer em loopback por padrão. Não exponha a API em `0.0.0.0` sem autenticação forte, TLS e regras de firewall. O daemon não executa comandos arbitrários enviados pela API. A integração com Docker/Podman exige validação de projetos, limites e isolamento antes de uso multiusuário ou exposição de API.

## Limites operacionais

Hospedagem local só permanece disponível enquanto o host estiver ligado, conectado e com recursos suficientes. Um frontend remoto não ganha acesso ao Docker local sem um daemon instalado e explicitamente pareado.

## Licença

A definir.

## Habilitar Nginx e HTTPS no host (GitHub Actions)

O workflow manual `.github/workflows/enable-nginx-https.yml` instala/configura Nginx e mkcert, compila o daemon, cria o serviço systemd `apolo-infra-daemon` e verifica `/readyz`. Ele **não usa runner hospedado pelo GitHub**: por alterar pacotes, serviços e o trust store, exige um runner próprio, confiável e dedicado ao host de destino.

1. Registre um runner Linux x86-64 Debian/Ubuntu no repositório com os rótulos `self-hosted`, `linux`, `x64` e `apolo-infra-host`. Execute o runner com usuário sem privilégios, mas com `sudo` não interativo autorizado para a administração do host. Não use um runner compartilhado com repositórios ou workflows não confiáveis.
2. Em **Actions → APOLO INFRA — Enable Nginx and HTTPS → Run workflow**, execute na branch `main`.
3. A opção `install_local_ca` vem desativada. Ative-a somente se este host deve confiar na CA local mkcert; isso altera o trust store do sistema e requer autorização administrativa.
4. Confirme os serviços `nginx` e `apolo-infra-daemon` e a resposta `ready` do endpoint local `http://127.0.0.1:8787/readyz`.

O workflow mantém a API em `127.0.0.1:8787`, cria uma conta de serviço sem login, restringe o sudo a `nginx -t` e `nginx -s reload`, e configura o diretório de vhosts dedicado. O usuário do daemon é adicionado ao grupo `docker` para permitir o uso do socket Docker, se instalado. O host precisa ter Docker ou Podman operacional e DNS/hosts apontando os domínios para ele. Certificados mkcert são apropriados para desenvolvimento e redes controladas; não são certificados públicos confiáveis por navegadores externos. Para HTTPS público, use uma CA pública (por exemplo, ACME/Let's Encrypt) e DNS público válido.

**Segurança:** a API ainda não possui autenticação. O bind loopback impede acesso remoto direto, mas processos locais ainda podem chamar a API; o acesso ao grupo `docker` também equivale, na prática, a privilégio elevado no host. Use somente em host confiável e não exponha a porta 8787 nem o daemon diretamente à Internet. Este workflow é destinado a host Linux Debian/Ubuntu x86-64 com runner self-hosted; não configura Android/Termux.
