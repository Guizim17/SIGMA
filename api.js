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

// Carrega o banco de dados
initSqlJs().then(SQL => {
  const fileBuffer = fs.readFileSync(path.join(__dirname, "medicamentos.db"));
  db = new SQL.Database(fileBuffer);
  console.log("✅ Banco carregado com sucesso!");
}).catch(err => {
  console.error("Erro ao carregar banco:", err);
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
      LIMIT 20
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

app.listen(PORT, () => {
  console.log(`✅ API rodando em http://localhost:${PORT}`);
});