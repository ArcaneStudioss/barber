'use strict';
// Banco de dados SQLite embutido no Node (node:sqlite). Um arquivo só, sem dependência nativa.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS professionals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  specialties TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  online_booking INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS professional_services (
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

-- Expediente semanal de cada profissional (minutos desde 00:00, horário local da barbearia)
CREATE TABLE IF NOT EXISTS professional_hours (
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  break_start_min INTEGER,
  break_end_min INTEGER,
  PRIMARY KEY (professional_id, weekday),
  CHECK (end_min > start_min)
);

-- Horário de funcionamento da barbearia
CREATE TABLE IF NOT EXISTS business_hours (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  closed INTEGER NOT NULL DEFAULT 0,
  open_min INTEGER NOT NULL DEFAULT 540,
  close_min INTEGER NOT NULL DEFAULT 1140
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,          -- AAAA-MM-DD no fuso da barbearia
  name TEXT NOT NULL
);

-- Folgas, férias e bloqueios. professional_id NULL = barbearia inteira.
CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bloqueio' CHECK (kind IN ('bloqueio','folga','ferias','intervalo')),
  reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_time_off_range ON time_off(start_at, end_at);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,     -- só dígitos, com DDI (ex.: 5511999999999)
  email TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  marketing_consent_at INTEGER,
  privacy_accepted_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  anonymized_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  professional_id INTEGER NOT NULL REFERENCES professionals(id),
  start_at INTEGER NOT NULL,      -- epoch ms UTC
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendente','confirmado','concluido','cancelado','nao_compareceu')),
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','telefone','presencial','whatsapp','painel')),
  customer_name TEXT NOT NULL,    -- nome informado neste agendamento
  total_price_cents INTEGER NOT NULL,
  total_duration_min INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  manage_token_hash TEXT,
  manage_token_expires_at INTEGER,
  payment_required_cents INTEGER NOT NULL DEFAULT 0,
  payment_expires_at INTEGER,
  cancelled_at INTEGER,
  cancel_reason TEXT,
  cancelled_by TEXT,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_appt_pro_time ON appointments(professional_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_appt_customer ON appointments(customer_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);

-- Garantia final contra sobreposição: mesmo que dois pedidos cheguem ao mesmo tempo,
-- o banco recusa qualquer agendamento ativo que se sobreponha a outro do mesmo profissional.
CREATE TRIGGER IF NOT EXISTS trg_appt_no_overlap_insert
BEFORE INSERT ON appointments
WHEN NEW.status IN ('pendente','confirmado')
BEGIN
  SELECT RAISE(ABORT, 'HORARIO_INDISPONIVEL')
  WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.professional_id = NEW.professional_id
      AND a.status IN ('pendente','confirmado','concluido')
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_appt_no_overlap_update
BEFORE UPDATE OF start_at, end_at, professional_id, status ON appointments
WHEN NEW.status IN ('pendente','confirmado')
BEGIN
  SELECT RAISE(ABORT, 'HORARIO_INDISPONIVEL')
  WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id <> NEW.id
      AND a.professional_id = NEW.professional_id
      AND a.status IN ('pendente','confirmado','concluido')
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at
  );
END;

CREATE TABLE IF NOT EXISTS appointment_services (
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_appt_services ON appointment_services(appointment_id);

CREATE TABLE IF NOT EXISTS appointment_events (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Pagamentos: online (Mercado Pago) e registrados manualmente no balcão.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  provider TEXT NOT NULL CHECK (provider IN ('mercadopago','balcao')),
  method TEXT NOT NULL DEFAULT '',          -- pix, cartao, dinheiro...
  kind TEXT NOT NULL DEFAULT 'integral' CHECK (kind IN ('sinal','integral','restante')),
  amount_cents INTEGER NOT NULL,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('aguardando','aprovado','recusado','cancelado','estornado','em_analise')),
  provider_payment_id TEXT UNIQUE,
  provider_preference_id TEXT,
  idempotency_key TEXT UNIQUE,
  checkout_url TEXT,
  recorded_by INTEGER,
  raw_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_appt ON payments(appointment_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','falhou','nao_configurado','cancelado')),
  scheduled_for INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(status, scheduled_for);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','profissional')),
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Sessões: staff (painel) e cliente. Guardamos só o hash do token.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('staff','cliente','agendamento')),
  user_id INTEGER,
  customer_id INTEGER,
  appointment_id INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- Códigos de verificação de acesso do cliente (guardamos só o hash)
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  channel TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','concluida','recusada')),
  customer_id INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  request_id TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

function open(file) {
  const target = file || config.databaseFile;
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const conn = new DatabaseSync(target);
  conn.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') {
    conn.exec('PRAGMA journal_mode = WAL;');
    conn.exec('PRAGMA busy_timeout = 5000;');
  }
  conn.exec(SCHEMA);
  return conn;
}

function get() {
  if (!db) db = open();
  return db;
}

function setForTests(conn) {
  db = conn;
}

// Executa fn dentro de uma transação de escrita exclusiva (BEGIN IMMEDIATE).
// Dois agendamentos simultâneos ficam em fila e o segundo enxerga o primeiro.
function tx(fn) {
  const conn = get();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* já desfeita */ }
    throw err;
  }
}

module.exports = { get, open, tx, setForTests, SCHEMA };
