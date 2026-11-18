# APOLO INFRA

Plataforma modular de controle e execução de infraestruturas de software. O painel será hospedado na Vercel; execuções temporárias de containers e testes de infraestrutura serão realizadas por GitHub Actions.

Estado atual: integração de ciclo de vida implementada; os testes de CI cobrem o daemon, Nginx real, Docker, Podman e confiança da CA mkcert no host.

## Arquitetura atual

- `apps/web`: painel Next.js/React (a integrar e publicar na Vercel).
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

## Execução temporária pelo GitHub Actions

O workflow `.github/workflows/infra-ephemeral.yml` substitui a antiga instalação permanente em runner próprio. Ele usa `ubuntu-latest`, sem exigir cadastro de runner self-hosted, e aceita disparo manual (`workflow_dispatch`) ou por API (`repository_dispatch`, tipo `apolo-infra-run`).

Operações disponíveis:

- `pull-only`: baixa a imagem Docker e valida o acesso ao engine.
- `smoke-test`: inicia um container temporário, opcionalmente publica uma porta apenas em `127.0.0.1` dentro do runner, verifica se o processo continua ativo após alguns segundos, coleta logs/inspect e remove o container ao final.

O artefato de diagnóstico fica disponível por 7 dias. A máquina do runner e seus containers são temporários e descartados ao final do job. A porta publicada não fica acessível pela Internet nem pela Vercel. Este workflow ainda é uma camada de execução/teste; não é hospedagem contínua de sites, bancos de dados ou serviços.

### Integração futura com o painel Vercel

O painel/API da Vercel poderá disparar `repository_dispatch` usando um GitHub App ou token de acesso armazenado exclusivamente como variável secreta no backend da Vercel. O evento deve enviar `client_payload` com `operation`, `name`, `image` e `container_port`. Nunca coloque o token no navegador. Ainda é necessário implementar no backend Vercel a autenticação do usuário, validação de permissões, disparo do evento, consulta do estado do workflow e persistência dos metadados em banco externo.

### Limites e persistência

- O daemon Go existente continua sendo um daemon local: seu SQLite, API e adaptadores Docker/Podman não se tornam automaticamente um serviço remoto persistente ao mudar o runner.
- O workflow atual não conecta o painel Vercel a um daemon permanente, não fornece IP/hostname público e não mantém containers ligados após o job.
- Dados que precisam sobreviver às execuções devem ficar em banco e armazenamento externos; logs e diagnósticos podem ser baixados como artefatos do Actions.
- Nginx e mkcert podem ser instalados/testados dentro de um job, mas sua configuração e certificados locais desaparecem com o runner. Para o site do painel, HTTPS público é gerenciado pela Vercel.
- Para hospedagem contínua real, será necessário um host persistente (VPS/servidor) ou uma plataforma de containers/serviços persistentes. GitHub Actions pode automatizar o deploy, mas não substitui esse host.

**Segurança:** mantenha tokens do GitHub no backend Vercel, com permissões mínimas para disparar workflows. Restrinja imagens e parâmetros aceitos, use tags/digests confiáveis, imponha limites de tempo/recursos e não aceite comandos shell arbitrários enviados pelo painel. O workflow atual é um primeiro executor de smoke tests, não uma API multiusuário pronta para produção.
