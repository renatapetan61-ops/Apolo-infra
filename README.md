# APOLO INFRA

Plataforma modular de controle e execução de infraestruturas. O painel e a API de controle são hospedados na Vercel; um worker em GitHub Codespaces executa Docker/Podman e configura Nginx enquanto o Codespace permanece ativo.

Estado atual: integração de ciclo de vida implementada; os testes de CI cobrem o daemon, Nginx real, Docker, Podman e confiança da CA mkcert no host.

## Arquitetura atual

- `apps/web`: painel Next.js + API de controle, autenticação Clerk e persistência em SQLite nativo, administrado pelo daemon Go no disco persistente do Codespace.\n- `apps/worker`: agente Node.js que recebe tarefas do control plane e executa Docker/Podman dentro do Codespace.\n- `.devcontainer`: ambiente GitHub Codespaces com Docker, Podman e Nginx.
- `cmd/apolo-infra-daemon`: processo local em Go.
- `internal/api`: API HTTP local; ainda sem autenticação, deve permanecer restrita a `127.0.0.1`.
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

## GitHub Actions (opcional)

O workflow `.github/workflows/infra-ephemeral.yml` permanece como ferramenta opcional de smoke tests. Ele não é o executor principal de infraestruturas e não oferece hospedagem contínua.



## Arquitetura Codespaces + Vercel

O painel e a API de controle ficam na Vercel. O worker `apps/worker/agent.mjs` roda dentro de um GitHub Codespace ativo e faz polling HTTPS de tarefas. Assim, não é necessário expor uma porta de administração do Codespace para a Internet.

### Persistência e disponibilidade

GitHub Codespaces é um ambiente de desenvolvimento gerenciado, não um host de produção 24/7. O timeout ocioso padrão é 30 minutos (configurável pelo usuário até 4 horas), e cada Codespace tem vida máxima de 12 horas; ao parar, os processos e containers deixam de atender, embora os arquivos salvos sejam preservados. O agente reinicia automaticamente quando o Codespace é iniciado novamente. O uso de computação é cobrado enquanto ele está ativo. Os metadados e histórico permanecem no arquivo SQLite local `data/apolo-infra.db` no disco do Codespace. O arquivo sobrevive a stop/start do mesmo Codespace; não sobrevive à exclusão/recriação do Codespace sem backup. Os volumes e dados de aplicações também precisam de backup próprio. Para hospedagem contínua de produção, use uma VPS ou serviço de containers permanente.

### Configuração inicial

1. Crie um Codespace para este repositório usando `.devcontainer/devcontainer.json`; o devcontainer instala Go, cria `data/apolo-infra.db`, executa as migrações e inicia o daemon SQLite na porta 8787.
2. Crie/seleciona uma aplicação Clerk e configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` no projeto Vercel.
3. Configure na Vercel `APOLO_DATABASE_API_URL` (URL pública encaminhada da porta 8787), `APOLO_DATABASE_API_TOKEN` (mesmo segredo do Codespaces), Clerk e `APOLO_WORKER_TOKEN`.
4. Em Codespaces secrets, configure `APOLO_DATABASE_API_TOKEN` (segredo exclusivo do SQLite), `APOLO_CONTROL_URL` (URL de produção Vercel) e `APOLO_WORKER_TOKEN` (segredo exclusivo do worker).
5. Copie a URL pública encaminhada da porta 8787 e configure-a como `APOLO_DATABASE_API_URL` na Vercel. Configure também `APOLO_DATABASE_API_TOKEN` com o mesmo valor secreto.
6. Verifique `https://URL-DO-CODESPACE-8787/readyz`; a resposta precisa indicar `status: ready` e `database: ok`.
7. Verifique os logs `~/.apolo-sqlite.log` e `~/.apolo-worker.log`, depois abra o painel Vercel e crie uma infraestrutura.

### Variáveis de ambiente

Ver `apps/web/.env.example`. A Vercel não grava o banco em seu filesystem efêmero: ela encaminha consultas autenticadas ao daemon SQLite próprio no Codespace. Configure `APOLO_DATABASE_API_URL` e `APOLO_DATABASE_API_TOKEN` na Vercel; o Codespace recebe o mesmo token. O worker usa separadamente `APOLO_CONTROL_URL` e `APOLO_WORKER_TOKEN`. Nunca commite tokens.

### Endpoints de controle

- `GET /api/health`: health check público do control plane.
- `POST /api/worker/heartbeat`, `/claim`, `/result`: endpoints do worker protegidos por Bearer token.
- `GET/POST /api/infrastructures`: listar e enfileirar infraestrutura para o usuário autenticado.
- `DELETE /api/infrastructures/:id`: enfileirar remoção.
- `GET /api/jobs`: consultar fila/histórico e workers.
- O dashboard atualiza o estado a cada cinco segundos.

### Escopo atual do worker

- Criação: pull de imagem e execução com limites básicos de 1 GiB RAM, 1 CPU e 256 processos; portas do container ficam ligadas a loopback.
- Exclusão: remove container e tenta remover configuração Nginx associada.
- Inspeção: operação disponível no agente, ainda sem botão dedicado no painel.
- O worker escolhe Docker quando disponível e usa Podman como fallback.
- Nginx atende um gateway compartilhado na porta 8080 do Codespace e publica cada aplicação em `/apps/<nome>/`. O worker retorna a URL pública encaminhada pelo Codespaces quando `CODESPACE_NAME` está disponível. Domínios próprios ainda exigem DNS/roteamento externo.
- O painel não oferece ainda volume persistente de containers, compose multi-serviço, ACME/Let's Encrypt, custom domain automático, quotas por usuário ou billing.

### Segurança e operação

- Configure restrições de cadastro no Clerk antes de abrir o painel publicamente.
- Use segredo aleatório forte e diferente para o worker; rotacione-o se for exposto.
- Não use imagens não confiáveis. O worker tem acesso ao Docker/Podman do Codespace e não deve executar código arbitrário recebido do painel.
- O executor atual não aceita shell arbitrário, bind mounts nem modo privileged.
- A porta 8080 é pública no Codespaces conforme o devcontainer; não coloque painel administrativo ou API de controle nessa porta.
- Se o Codespace parar, o worker fica offline. O painel preserva o estado, mas não consegue manter aplicações ativas.



## Dashboard visual e envio de projetos

O dashboard usa o componente oficial **ShinyText** do [React Bits](https://reactbits.dev/text-animations/shiny-text), integrado em `apps/web/src/components/reactbits`, além de uma identidade visual própria, responsiva e com efeitos leves. O componente mantém a licença e os créditos do projeto original.

Para criar a partir do código-fonte, selecione a **pasta do projeto** no navegador. O painel envia os arquivos individuais com seus caminhos relativos — não é necessário compactar em ZIP. Pastas de dependências e artefatos (`.git`, `node_modules`, `.next`, `dist`, `build`, etc.) são ignoradas. Limites atuais: 3 MB e 1.000 arquivos. O worker reconstrói o diretório temporário e executa o build com Docker/Podman.
