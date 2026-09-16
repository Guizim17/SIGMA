const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const fs       = require("fs");
const initSqlJs = require("sql.js");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { version: APP_VERSAO } = require("../package.json");

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

// ── Exportar / importar ficha em PDF (dados embutidos como anexo) ──

const SCHEMA_FICHA = "ficha-paciente";
const SCHEMA_FICHA_VERSAO = 1;

// Remove caracteres fora da faixa suportada pela codificação WinAnsi das fontes padrão do pdf-lib
function textoSeguroPdf(texto) {
  return String(texto ?? "").replace(/[^ -ÿ]/g, "?");
}

// Transforma o nome do paciente num nome de arquivo ASCII seguro (fallback do Content-Disposition)
function slugAscii(texto) {
  return String(texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Gera o PDF legível da ficha (layout formal, pensado para impressão) e embute
// o JSON estruturado como anexo
async function gerarPdfFicha(ficha) {
  const pdfDoc = await PDFDocument.create();
  const fonte       = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonteItalico = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const MARGEM = 56, LARGURA = 595.28, ALTURA = 841.89; // A4
  const PRETO       = rgb(0.08, 0.08, 0.08);
  const CINZA       = rgb(0.42, 0.42, 0.42);
  const CINZA_CLARO = rgb(0.72, 0.72, 0.72);

  let page = pdfDoc.addPage([LARGURA, ALTURA]);
  let y = ALTURA - MARGEM;

  function novaPaginaSeNecessario(alturaLinha = 16) {
    if (y - alturaLinha < MARGEM + 46) {
      page = pdfDoc.addPage([LARGURA, ALTURA]);
      y = ALTURA - MARGEM;
    }
  }

  function largura(txt, fonteUsada, tamanho) {
    return fonteUsada.widthOfTextAtSize(textoSeguroPdf(txt), tamanho);
  }

  function texto(txt, x, yPos, { negrito = false, italico = false, tamanho = 11, cor = PRETO } = {}) {
    const fonteUsada = italico ? fonteItalico : negrito ? fonteNegrito : fonte;
    page.drawText(textoSeguroPdf(txt), { x, y: yPos, size: tamanho, font: fonteUsada, color: cor });
  }

  function linha(txt, opts = {}) {
    novaPaginaSeNecessario();
    texto(txt, MARGEM, y, opts);
    y -= (opts.tamanho || 11) + (opts.espaco ?? 7);
  }

  function linhaComQuebra(txt, opts = {}) {
    const largurap = LARGURA - MARGEM * 2;
    const fonteUsada = opts.negrito ? fonteNegrito : opts.italico ? fonteItalico : fonte;
    const tamanho = opts.tamanho || 11;
    const palavras = textoSeguroPdf(txt).split(/\s+/);
    let atual = "";
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonteUsada.widthOfTextAtSize(tentativa, tamanho) > largurap && atual) {
        linha(atual, opts);
        atual = palavra;
      } else {
        atual = tentativa;
      }
    }
    if (atual) linha(atual, opts);
  }

  function regua() {
    novaPaginaSeNecessario(4);
    page.drawLine({ start: { x: MARGEM, y }, end: { x: LARGURA - MARGEM, y }, thickness: 0.75, color: CINZA_CLARO });
    y -= 20;
  }

  // Cabeçalho tipo timbre
  const dataGeracao = new Date(ficha.gerado_em).toLocaleString("pt-BR");
  texto("SIGMA", MARGEM, y, { negrito: true, tamanho: 12 });
  texto(dataGeracao, LARGURA - MARGEM - largura(dataGeracao, fonte, 9), y, { tamanho: 9, cor: CINZA });
  y -= 14;
  texto("Sistema de gestão de fichas médicas", MARGEM, y, { tamanho: 9, cor: CINZA });
  y -= 20;
  regua();

  // Título centralizado
  const titulo = "FICHA DE PACIENTE";
  texto(titulo, (LARGURA - largura(titulo, fonteNegrito, 17)) / 2, y, { negrito: true, tamanho: 17 });
  y -= 34;

  // Nome em destaque
  texto("NOME", MARGEM, y, { tamanho: 9, cor: CINZA });
  y -= 16;
  texto(ficha.paciente.nome, MARGEM, y, { negrito: true, tamanho: 15 });
  y -= 26;

  // Idade / peso lado a lado
  const colX = MARGEM + (LARGURA - MARGEM * 2) / 2;
  texto("IDADE", MARGEM, y, { tamanho: 9, cor: CINZA });
  texto("PESO", colX, y, { tamanho: 9, cor: CINZA });
  y -= 16;
  texto(ficha.paciente.idade != null ? `${ficha.paciente.idade} anos` : "Não informado", MARGEM, y, { tamanho: 12 });
  texto(ficha.paciente.peso != null ? `${ficha.paciente.peso} kg` : "Não informado", colX, y, { tamanho: 12 });
  y -= 28;

  // Alergias — caixa com contorno (sem preenchimento) quando houver, pra chamar
  // atenção mesmo numa impressão em preto e branco
  if (ficha.paciente.alergias) {
    novaPaginaSeNecessario(44);
    const topoCaixa = y;
    page.drawRectangle({ x: MARGEM, y: topoCaixa - 38, width: LARGURA - MARGEM * 2, height: 38, borderColor: PRETO, borderWidth: 1 });
    texto("ALERGIAS", MARGEM + 12, topoCaixa - 15, { negrito: true, tamanho: 9 });
    texto(ficha.paciente.alergias, MARGEM + 12, topoCaixa - 30, { tamanho: 11.5 });
    y = topoCaixa - 38 - 20;
  } else {
    texto("ALERGIAS", MARGEM, y, { tamanho: 9, cor: CINZA });
    y -= 16;
    texto("Nenhuma registrada", MARGEM, y, { tamanho: 11, cor: CINZA });
    y -= 26;
  }

  // Observações
  texto("OBSERVAÇÕES", MARGEM, y, { tamanho: 9, cor: CINZA });
  y -= 16;
  linhaComQuebra(ficha.paciente.observacoes || "Nenhuma registrada", {
    tamanho: 11,
    cor: ficha.paciente.observacoes ? PRETO : CINZA,
    espaco: 5,
  });
  y -= 8;

  regua();

  // Medicamentos em lista numerada
  linha("MEDICAMENTOS EM USO", { negrito: true, tamanho: 11, espaco: 14 });
  if (!ficha.medicamentos.length) {
    linha("Nenhum medicamento registrado.", { cor: CINZA });
  } else {
    ficha.medicamentos.forEach((m, i) => linha(`${i + 1}.  ${m.nome_medicamento}`, { tamanho: 11.5, espaco: 9 }));
  }

  // Rodapé com paginação em todas as páginas
  const paginas = pdfDoc.getPages();
  paginas.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGEM, y: MARGEM - 8 }, end: { x: LARGURA - MARGEM, y: MARGEM - 8 }, thickness: 0.5, color: CINZA_CLARO });
    pg.drawText(
      textoSeguroPdf(`Gerado eletronicamente pelo SIGMA v${ficha.gerado_por.versao}. Contém dados estruturados embutidos para reimportação no sistema.`),
      { x: MARGEM, y: MARGEM - 21, size: 7.5, font: fonteItalico, color: CINZA }
    );
    const paginacao = `Página ${i + 1} de ${paginas.length}`;
    pg.drawText(paginacao, { x: LARGURA - MARGEM - largura(paginacao, fonte, 8), y: MARGEM - 20, size: 8, font: fonte, color: CINZA });
  });

  const jsonBytes = Buffer.from(JSON.stringify(ficha, null, 2), "utf-8");
  await pdfDoc.attach(jsonBytes, "ficha.json", {
    mimeType: "application/json",
    description: "Dados estruturados da ficha para reimportação no SIGMA",
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return pdfDoc.save();
}

// pdfjs-dist v4+ só publica ESM — em módulo CommonJS precisa de import() dinâmico
let _pdfjsLibPromise;
function carregarPdfjs() {
  if (!_pdfjsLibPromise) _pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjsLibPromise;
}

// Lê o PDF enviado e extrai o anexo "ficha.json", se existir
async function extrairFichaDoPdf(bufferPdf) {
  const pdfjsLib = await carregarPdfjs();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(bufferPdf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  // getAttachments() só traz metadados (nome/descrição); o conteúdo é buscado
  // separadamente com getAttachmentContent(id), usando a mesma chave do mapa
  const anexosBrutos = await doc.getAttachments();
  const entradas = typeof anexosBrutos?.entries === "function"
    ? Array.from(anexosBrutos.entries())
    : Object.entries(anexosBrutos || {});

  const entrada = entradas.find(([, meta]) => meta.filename === "ficha.json");
  if (!entrada) return null;

  const [idAnexo] = entrada;
  const conteudo = await doc.getAttachmentContent(idAnexo);
  if (!conteudo) return null;

  const textoJson = Buffer.from(conteudo).toString("utf-8");
  return JSON.parse(textoJson);
}

// ── Rota de exportação da ficha em PDF ──
app.get("/pacientes/:id/exportar", async (req, res) => {
  try {
    const paciente = umaLinha(
      `SELECT id, nome, idade, peso, alergias, observacoes, criado_em FROM pacientes WHERE id = ?`,
      [req.params.id]
    );
    if (!paciente) return res.status(404).json({ erro: "Paciente não encontrado." });

    const medicamentos = todasLinhas(
      `SELECT nome_medicamento FROM paciente_medicamentos WHERE id_paciente = ? ORDER BY nome_medicamento ASC`,
      [req.params.id]
    );

    const ficha = {
      sigma_schema: SCHEMA_FICHA,
      sigma_schema_versao: SCHEMA_FICHA_VERSAO,
      gerado_em: new Date().toISOString(),
      gerado_por: { app: "SIGMA", versao: APP_VERSAO },
      paciente: {
        nome: paciente.nome,
        idade: paciente.idade,
        peso: paciente.peso,
        alergias: paciente.alergias,
        observacoes: paciente.observacoes,
      },
      medicamentos: medicamentos.map(m => ({ nome_medicamento: m.nome_medicamento })),
    };

    const pdfBytes = await gerarPdfFicha(ficha);
    const nomeArquivo = slugAscii(paciente.nome) || `paciente-${paciente.id}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ficha-${nomeArquivo}.pdf"; filename*=UTF-8''ficha-${encodeURIComponent(paciente.nome)}.pdf`
    );
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Erro ao exportar ficha:", err);
    res.status(500).json({ erro: "Erro ao gerar o PDF da ficha." });
  }
});

// ── Rota de importação da ficha a partir de um PDF ──
app.post("/pacientes/importar", express.raw({ type: "application/pdf", limit: "10mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ erro: "Envie o PDF com Content-Type: application/pdf." });
  }

  let ficha;
  try {
    ficha = await extrairFichaDoPdf(req.body);
  } catch (err) {
    console.error("Erro ao ler PDF:", err);
    return res.status(422).json({ erro: "Não foi possível ler este PDF. O arquivo está corrompido ou não é um PDF válido." });
  }

  if (!ficha || ficha.sigma_schema !== SCHEMA_FICHA) {
    return res.status(422).json({ erro: "Este PDF não contém uma ficha de paciente exportada pelo SIGMA." });
  }
  if (ficha.sigma_schema_versao !== SCHEMA_FICHA_VERSAO) {
    return res.status(422).json({ erro: `Versão de ficha (${ficha.sigma_schema_versao}) não suportada por esta versão do SIGMA.` });
  }

  const p = ficha.paciente || {};
  const nome = (p.nome || "").trim();
  if (!nome) return res.status(422).json({ erro: "A ficha não tem nome de paciente válido." });

  const idade = Number.isFinite(Number(p.idade)) ? Number(p.idade) : null;
  const peso  = Number.isFinite(Number(p.peso))  ? Number(p.peso)  : null;
  const medicamentos = Array.isArray(ficha.medicamentos)
    ? ficha.medicamentos.filter(m => m && typeof m.nome_medicamento === "string" && m.nome_medicamento.trim())
    : [];

  const forcar = req.query.forcar === "true";

  if (!forcar) {
    const existente = umaLinha(
      `SELECT id, nome, idade, peso FROM pacientes
       WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?))
         AND ((idade IS NULL AND ? IS NULL) OR idade = ?)`,
      [nome, idade, idade]
    );
    if (existente) {
      return res.status(409).json({
        erro: "Já existe um paciente com nome e idade parecidos.",
        existente,
      });
    }
  }

  try {
    const novoId = executar(
      `INSERT INTO pacientes (nome, idade, peso, alergias, observacoes) VALUES (?, ?, ?, ?, ?)`,
      [nome, idade, peso, p.alergias || null, p.observacoes || null]
    );
    medicamentos.forEach(m => {
      executar(
        `INSERT INTO paciente_medicamentos (id_paciente, nome_medicamento) VALUES (?, ?)`,
        [novoId, m.nome_medicamento.trim()]
      );
    });
    res.status(201).json({ id: novoId, nome });
  } catch (err) {
    console.error("Erro ao importar ficha:", err);
    res.status(500).json({ erro: "Erro ao gravar a ficha importada." });
  }
});

// Middleware de erro: payload de importação maior que o limite permitido
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ erro: "Arquivo PDF excede o tamanho máximo permitido (10MB)." });
  }
  console.error(err);
  res.status(500).json({ erro: "Erro inesperado no servidor." });
});

app.listen(PORT, () => {
  console.log(`✅ API rodando em http://localhost:${PORT}`);
});