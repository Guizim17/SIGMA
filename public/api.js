const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const fs       = require("fs");
const initSqlJs = require("sql.js");

const app  = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let db;
const DB_PATH = path.join(process.env.APP_ROOT || path.join(__dirname, "..", "data"), "medicamentos.db");

// Carrega o banco de dados
initSqlJs().then(SQL => {
  const fileBuffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(fileBuffer);
  console.log("✅ Banco carregado com sucesso!");
}).catch(err => {
  console.error("Erro ao carregar banco:", err);
});

// Persiste as alterações em memória de volta no arquivo .db
function salvarBanco() {
  const dados = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(dados));
}

// Executa um INSERT/UPDATE/DELETE com parâmetros, persiste e retorna o último ID inserido
function executar(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();

  const idStmt = db.prepare(`SELECT last_insert_rowid() AS id`);
  idStmt.step();
  const { id } = idStmt.getAsObject();
  idStmt.free();

  salvarBanco();
  return id;
}

// Executa um SELECT e retorna todas as linhas como objetos
function todasLinhas(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Executa um SELECT e retorna a primeira linha (ou null)
function umaLinha(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

// ── Rota de listagem inicial (ordem alfabética) ──
app.get("/medicamentos/iniciais", (req, res) => {
  try {
    const rows = todasLinhas(`
      SELECT id, nome_medicamento, categoria, via_administracao
      FROM bulas_profissionais
      ORDER BY nome_medicamento ASC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar medicamentos iniciais:", err.message);
    res.status(500).json({ erro: "Erro ao consultar o banco." });
  }
});

// ── Rota de busca ────────────────────────────
app.get("/buscar", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  try {
    const stmt = db.prepare(`
      SELECT id, nome_medicamento, categoria, via_administracao
      FROM bulas_profissionais
      WHERE nome_medicamento LIKE :q
      ORDER BY nome_medicamento ASC
      LIMIT 100
    `);

    const rows = [];
    stmt.bind({ ":q": `%${q}%` });
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    res.json(rows);
  } catch (err) {
    console.error("Erro na busca:", err.message);
    res.status(500).json({ erro: "Erro ao consultar o banco." });
  }
});

// ── Rota de detalhe ──────────────────────────
app.get("/medicamento/:id", (req, res) => {
  const { id } = req.params;
  if (!Number.isInteger(Number(id))) {
    return res.status(400).json({ erro: "ID inválido." });
  }

  try {
    const stmt = db.prepare(`
      SELECT
        id, nome_medicamento, categoria, resumo,
        efeitos_colaterais, interacoes_medicamentosas,
        link_pdf, via_administracao
      FROM bulas_profissionais
      WHERE id = :id
    `);

    stmt.bind({ ":id": Number(id) });
    if (stmt.step()) {
      res.json(stmt.getAsObject());
    } else {
      res.status(404).json({ erro: "Medicamento não encontrado." });
    }
    stmt.free();
  } catch (err) {
    console.error("Erro ao buscar detalhe:", err.message);
    res.status(500).json({ erro: "Erro ao consultar o banco." });
  }
});

// ── Rota de verificação de interação ─────────
app.get("/interacao", (req, res) => {
  const nomeA = (req.query.a || "").trim();
  const nomeB = (req.query.b || "").trim();

  if (!nomeA || !nomeB) {
    return res.status(400).json({ erro: "Informe os dois medicamentos." });
  }

  try {
    const stmt = db.prepare(`
      SELECT
        [Existe Interação Relevante?] AS existe,
        [Gravidade]                   AS gravidade,
        [Mecanismo]                   AS mecanismo,
        [Efeito Clínico]              AS efeito,
        [Recomendação]                AS recomendacao
      FROM Interacoes
      WHERE
        ([Medicamento A] = ? AND [Medicamento B] = ?)
        OR
        ([Medicamento A] = ? AND [Medicamento B] = ?)
      LIMIT 1
    `);

    stmt.bind([nomeA, nomeB, nomeB, nomeA]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();

      const encontrada = (row.existe || "").toLowerCase().includes("sim");

      return res.json({
        encontrada,
        gravidade:   row.gravidade   || null,
        mecanismo:   row.mecanismo   || null,
        efeito:      row.efeito      || null,
        recomendacao: row.recomendacao || null,
      });
    }

    stmt.free();

    // Par não encontrado na tabela
    return res.json({ encontrada: false, semDados: true });

  } catch (err) {
    console.error("Erro na verificação:", err.message);
    res.status(500).json({ erro: "Erro ao consultar o banco." });
  }
});
// ── Rotas de pacientes ────────────────────────

// Lista todos os pacientes
app.get("/pacientes", (req, res) => {
  try {
    const rows = todasLinhas(`
      SELECT id, nome, idade, peso, alergias, observacoes, criado_em
      FROM pacientes
      ORDER BY nome ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Cria um novo paciente
app.post("/pacientes", (req, res) => {
  const { nome, idade, peso, alergias, observacoes } = req.body;
  if (!nome) return res.status(400).json({ erro: "Nome é obrigatório." });
  try {
    const id = executar(
      `INSERT INTO pacientes (nome, idade, peso, alergias, observacoes) VALUES (?, ?, ?, ?, ?)`,
      [nome, idade || null, peso || null, alergias || null, observacoes || null]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Busca um paciente pelo ID com seus medicamentos
app.get("/pacientes/:id", (req, res) => {
  try {
    const paciente = umaLinha(
      `SELECT id, nome, idade, peso, alergias, observacoes, criado_em FROM pacientes WHERE id = ?`,
      [req.params.id]
    );

    if (!paciente) return res.status(404).json({ erro: "Paciente não encontrado." });

    const medicamentos = todasLinhas(
      `SELECT id, nome_medicamento FROM paciente_medicamentos
       WHERE id_paciente = ?
       ORDER BY nome_medicamento ASC`,
      [req.params.id]
    );

    res.json({ ...paciente, medicamentos });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Adiciona medicamento a um paciente
app.post("/pacientes/:id/medicamentos", (req, res) => {
  const { nome_medicamento } = req.body;
  if (!nome_medicamento) return res.status(400).json({ erro: "Nome do medicamento é obrigatório." });
  try {
    const id = executar(
      `INSERT INTO paciente_medicamentos (id_paciente, nome_medicamento) VALUES (?, ?)`,
      [req.params.id, nome_medicamento]
    );
    res.json({ id, nome_medicamento });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Remove medicamento de um paciente
app.delete("/pacientes/:id/medicamentos/:midId", (req, res) => {
  try {
    executar(
      `DELETE FROM paciente_medicamentos WHERE id = ? AND id_paciente = ?`,
      [req.params.midId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Deleta um paciente e seus medicamentos
app.delete("/pacientes/:id", (req, res) => {
  try {
    executar(`DELETE FROM paciente_medicamentos WHERE id_paciente = ?`, [req.params.id]);
    executar(`DELETE FROM pacientes WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API rodando em http://localhost:${PORT}`);
});