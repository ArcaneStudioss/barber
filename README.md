# Barbearia Exemplo

Site, agendamento online, área do cliente e painel administrativo de uma barbearia.
Funciona de verdade: banco de dados, login, regras de agenda e trava contra horário duplicado.

- **Stack:** Node.js 22.13+ · Express · SQLite embutido no Node (`node:sqlite`) · HTML renderizado no servidor + JavaScript puro.
- **Uma dependência só** (`express`). Sem build, sem banco externo, sem pacote nativo para compilar.
- Textos em português do Brasil, preços em reais, datas dd/mm/aaaa, fuso `America/Sao_Paulo`.

---

## 1. Rodar no computador

```bash
npm install
npm run setup                      # cria o banco, horário padrão e feriados nacionais
npm run demo:seed                  # (opcional) dados FICTÍCIOS para demonstração; mostra logins de teste
DEV_CONSOLE_NOTIFICATIONS=1 npm run dev
```

Abra `http://localhost:8080` (site) e `http://localhost:8080/admin` (painel).

Criar o administrador real:

```bash
ADMIN_EMAIL=dono@barbearia.com.br ADMIN_NAME="Nome do dono" npm run setup
```

A senha é gerada e mostrada uma única vez (ou defina `ADMIN_PASSWORD`).

Testes automáticos (18 cenários, banco temporário):

```bash
npm test
```

## 2. O que trocar antes de publicar

Tudo que está entre **[COLCHETES]** no site é um campo para substituir. Nada foi inventado: depoimentos, prêmios, história e dados da empresa ficam em branco até o cliente fornecer.

| O quê | Onde |
|---|---|
| Endereço, WhatsApp, telefone, Instagram, e-mail, mapa, CNPJ, descrição | Painel > Configurações > Dados da barbearia |
| Horário de funcionamento | Painel > Configurações > Horário de funcionamento |
| Serviços, preços, duração | Painel > Serviços |
| Equipe, especialidades, expediente e intervalo | Painel > Equipe e horários |
| Feriados estaduais e municipais | Painel > Folgas e bloqueios |
| Texto "Sobre", fotos da galeria, foto principal, depoimentos | `src/content.js` |
| Fotos | `public/img/` (de preferência `.webp`, até ~250 KB; principal 1200×1500, equipe 900×1200) |
| Política de privacidade e termos | `src/views/pages.js` (modelos; revisar com o cliente) |

**Depoimentos:** só com autorização por escrito. Enquanto `testimonials` estiver vazio, a seção não aparece.

**Dados de demonstração:** tudo criado por `npm run demo:seed` fica marcado como demonstração (aviso visível no site e no painel). Para apagar:

```bash
npm run demo:remove
```

Itens de demonstração que você editar no painel passam a ser reais e são mantidos.

## 3. Publicar

### Variáveis de ambiente

Copie `.env.example` e preencha. Obrigatórias em produção:

| Variável | Para quê |
|---|---|
| `NODE_ENV=production` | Liga cookies seguros, HSTS e as checagens abaixo |
| `BASE_URL` | Endereço público com `https://` (usado em links, sitemap, webhook) |
| `APP_SECRET` | 32+ caracteres aleatórios. Protege tokens e códigos |
| `TRUST_PROXY=1` | Quando há proxy/CDN na frente (IP real para limitar tentativas) |
| `DATABASE_FILE` | Caminho do banco em disco **persistente** |

### Discloud

1. `discloud.config` já está no projeto (ajuste `NAME`, `RAM` e o subdomínio/ID conforme o seu plano).
2. Envie o projeto **sem** `node_modules`, `data/` e `.env`. Configure as variáveis no painel da Discloud.
3. Depois do primeiro deploy, crie o administrador pelo terminal da Discloud: `ADMIN_EMAIL=... npm run setup`.
4. **Antes de todo novo deploy, faça backup** (seção 6) e, depois, confira que os agendamentos continuam lá.
5. A Cloudflare guarda `.css/.js` por algumas horas: o projeto já gera `?v=` novo a cada reinício.

### VPS / outro provedor

Qualquer servidor com Node 22.13+: `npm ci --omit=dev && npm start`, atrás de Nginx/Caddy com HTTPS. Use um gerenciador de processo (systemd ou pm2) e mantenha **uma única instância** (o limite de tentativas fica na memória do processo; o banco SQLite já serializa as gravações).

### Domínio e Google

- Aponte o domínio e ative HTTPS.
- Envie `https://seudominio/sitemap.xml` no Google Search Console.
- Crie/atualize o Perfil da Empresa no Google com o mesmo nome, endereço e telefone do site (SEO local).

## 4. Integrações: o que falta configurar

Nenhuma mensagem ou pagamento é simulado. Sem credencial, a notificação fica registrada como **"não configurado"** no painel e o agendamento funciona normalmente. O painel (Configurações > Integrações) mostra exatamente o que falta.

### E-mail: Resend

1. Crie conta em resend.com e verifique o domínio da barbearia (registros DNS).
2. `RESEND_API_KEY` = chave da API · `EMAIL_FROM` = `Barbearia Exemplo <agenda@seudominio.com.br>`.

Envia: confirmação, lembretes, cancelamento, remarcação e código de acesso à área do cliente.

### WhatsApp: Cloud API oficial da Meta

1. Conta Meta Business verificada + número de WhatsApp Business na Cloud API.
2. `WHATSAPP_TOKEN` (token permanente de usuário do sistema) e `WHATSAPP_PHONE_NUMBER_ID`.
3. Crie e aprove os modelos (categoria **Utilidade**, idioma `pt_BR`) com estes parâmetros, nesta ordem:
   `{{1}}` nome · `{{2}}` data · `{{3}}` hora · `{{4}}` serviços · `{{5}}` profissional · `{{6}}` número do agendamento.
   - `WHATSAPP_TEMPLATE_CONFIRMACAO` e `WHATSAPP_TEMPLATE_LEMBRETE` (obrigatórios)
   - `WHATSAPP_TEMPLATE_CANCELAMENTO` e `WHATSAPP_TEMPLATE_REAGENDAMENTO` (opcionais)
4. Código de acesso: modelo da categoria **Autenticação** com botão "copiar código" → `WHATSAPP_TEMPLATE_CODIGO`.

Exemplo de texto do modelo de confirmação:
> Olá, {{1}}! Seu horário na Barbearia Exemplo está confirmado para {{2}} às {{3}}. Serviços: {{4}}, com {{5}}. Número: {{6}}.

O botão flutuante do site abre conversa com o WhatsApp informado no painel (não depende da API).

### Pagamento online: Mercado Pago (opcional)

1. Em mercadopago.com.br/developers, crie uma aplicação e pegue o **Access Token de produção** → `MP_ACCESS_TOKEN`.
2. Em Webhooks, cadastre `https://seudominio/webhooks/mercadopago`, evento **Pagamentos**, e copie a assinatura secreta → `MP_WEBHOOK_SECRET`.
3. No painel, Configurações > Pagamento online: escolha sinal (%) ou integral e o prazo para pagar.

Como funciona:
- O cliente paga na página do Mercado Pago (Pix ou cartão). **Nenhum dado de cartão passa pelo servidor.**
- O horário fica reservado como *pendente* até o prazo; sem pagamento, é liberado automaticamente.
- A confirmação só vem por **webhook com assinatura validada**, e o pagamento é conferido direto na API do Mercado Pago (o corpo do webhook nunca é confiado).
- Um agendamento nunca tem duas cobranças abertas; reenvios do webhook não duplicam pagamento (id único).
- Pagamento que chega depois do prazo: reativa o horário se ele ainda estiver livre; senão, avisa no painel para estornar (botão **Estornar** no agendamento).

## 5. Como o agendamento funciona

1. Serviços (um ou mais; duração e preço somados) → 2. profissional ou "qualquer disponível" → 3. dia → 4. só horários realmente livres → 5. nome, celular, e-mail opcional → 6. revisão → 7. confirmação com número, calendário (.ics e Google Agenda) e link seguro.

Regras aplicadas no servidor:
- Expediente do profissional **cruzado** com o funcionamento da barbearia, menos intervalo, feriados, folgas, férias e bloqueios.
- Antecedência mínima, limite de dias à frente e grade de minutos configuráveis.
- **Sem sobreposição:** cada reserva roda numa transação exclusiva e o banco tem um gatilho que recusa qualquer horário sobreposto do mesmo profissional, mesmo com pedidos simultâneos (testado com 6 reservas ao mesmo tempo: 1 passa, 5 recebem "horário indisponível").
- Cancelamento e remarcação pelo cliente respeitam prazo e limite configurados.

**Acesso sem senha:**
- Ao agendar, o cliente recebe um **link secreto** que abre só aquele agendamento.
- Para ver todo o histórico e alterar dados: **código de 6 dígitos** por e-mail ou WhatsApp (vale 10 min, 5 tentativas, uso único).
- Agendar com o telefone de outra pessoa **não** dá acesso ao histórico nem altera o cadastro dela.

## 6. Backup (obrigatório antes de publicar)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # gera a BACKUP_KEY (guarde fora do servidor)
BACKUP_KEY=... npm run backup        # cópia consistente, criptografada (AES-256-GCM) e verificada
BACKUP_KEY=... node scripts/restore.js backups/arquivo.db.enc data/restaurado.db
```

- Agende `npm run backup` diariamente (cron do servidor ou rotina da hospedagem).
- Copie a pasta `backups/` para fora do servidor (Cloudflare R2, Backblaze B2 ou Drive, por exemplo com `rclone`).
- Teste a restauração pelo menos uma vez por mês.

## 7. Segurança e LGPD

- Validação de todos os dados no servidor; mensagens de erro claras por campo.
- Senhas com scrypt; sessões em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção; só o hash dos tokens fica no banco.
- Bloqueio de 15 min após 5 senhas erradas no painel; limite de tentativas por IP e por telefone em reserva, código e login.
- Proteção CSRF por checagem de origem; campo isca contra robôs; CSP com nonce; HSTS; `X-Frame-Options`.
- Perfis: **administrador** (tudo) e **profissional** (só a própria agenda e os clientes que atende; sem relatórios, exportação nem configurações).
- Registro de auditoria das ações do painel.
- LGPD: coleta mínima (nome e celular; e-mail opcional), finalidade informada, consentimento de marketing **separado** e opcional, formulário de pedidos do titular, exclusão (anonimização) pelo painel.
- Exportação CSV com proteção contra injeção de fórmula.
- Segredos só em variáveis de ambiente. `.env`, `data/` e `backups/` estão no `.gitignore` e nunca são servidos.

## 8. Estrutura

```
server.js                 inicia o servidor e as rotinas (fila de notificações, liberação de horários)
src/
  config.js               variáveis de ambiente e status das integrações
  db.js                   esquema do banco (tabelas, índices, gatilhos anti-sobreposição)
  bootstrap.js            horário padrão e feriados nacionais
  content.js              textos e fotos editoriais
  lib/                    agenda, disponibilidade, autenticação, notificações, pagamentos, fuso, validação
  routes/                 API pública, área do cliente e painel
  views/                  páginas HTML (layout, SEO, dados estruturados)
public/                   CSS, JS, fontes (auto-hospedadas) e imagens
scripts/                  setup, demonstração, backup e restauração
test/                     testes de ponta a ponta
```

**Tabelas:** `settings`, `services`, `professionals`, `professional_services`, `professional_hours`, `business_hours`, `holidays`, `time_off`, `customers`, `appointments`, `appointment_services`, `appointment_events`, `payments`, `notifications`, `users`, `sessions`, `otp_codes`, `privacy_requests`, `audit_log`, `webhook_events`.

## 9. Checklist de lançamento

- [ ] Dados reais da barbearia no painel (nenhum `[CAMPO]` aparecendo no site)
- [ ] Fotos reais em `public/img` e `src/content.js`
- [ ] `npm run demo:remove`
- [ ] Administrador real criado; usuários dos profissionais criados
- [ ] Política de privacidade e termos revisados pelo cliente
- [ ] `NODE_ENV`, `BASE_URL`, `APP_SECRET`, `TRUST_PROXY` configurados
- [ ] Backup diário + cópia externa + restauração testada
- [ ] (Opcional) Resend, WhatsApp e Mercado Pago com credenciais; teste real de cada um
- [ ] Sitemap enviado ao Google; Perfil da Empresa no Google atualizado
