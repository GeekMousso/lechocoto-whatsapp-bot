import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
} = process.env;

const WA_API = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

// --- mini “DB” en mémoire (remplace par Redis en prod)
const sessions = new Map();
/*
session = {
  step: "MENU" | "PACK" | "SIZE" | "COLOR" | "DELIVERY" | "PAYMENT" | "CONFIRM",
  pack, size, color, commune, address, payment
}
*/

function getSession(from) {
  if (!sessions.has(from)) sessions.set(from, { step: "MENU" });
  return sessions.get(from);
}

async function sendMessage(payload) {
  await axios.post(WA_API, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
}

async function sendText(to, text) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendMenu(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Bienvenue chez *Le CHOCOTO* 🩲\nQue souhaites-tu faire ?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "CMD", title: "🛒 Commander" } },
          { type: "reply", reply: { id: "CAT", title: "📸 Catalogue" } },
          { type: "reply", reply: { id: "HUM", title: "👤 Parler à un agent" } },
        ],
      },
    },
  });
}

async function sendPackChoice(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Choisis ton pack 👇" },
      action: {
        button: "Sélectionner",
        sections: [
          {
            title: "Packs",
            rows: [
              { id: "PACK_1", title: "1 boxer", description: "Achat simple" },
              { id: "PACK_2", title: "Pack 2", description: "Le plus pris ✅" },
              { id: "PACK_3", title: "Pack 3", description: "Meilleur deal 🔥" },
            ],
          },
        ],
      },
    },
  });
}

async function sendSizeChoice(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Quelle taille ?" },
      action: {
        button: "Tailles",
        sections: [
          {
            title: "Tailles disponibles",
            rows: [
              { id: "SIZE_L", title: "L" },
              { id: "SIZE_XL", title: "XL" },
              { id: "SIZE_2XL", title: "2XL" },
              { id: "SIZE_3XL", title: "3XL" },
              { id: "SIZE_4XL", title: "4XL" },
            ],
          },
        ],
      },
    },
  });
}

async function sendColorChoice(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Quelle couleur ?" },
      action: {
        button: "Couleurs",
        sections: [
          {
            title: "Couleurs",
            rows: [
              { id: "COL_VERT", title: "Vert" },
              { id: "COL_BLEU", title: "Bleu marine" },
              { id: "COL_NOIR", title: "Noir" },
              { id: "COL_GRIS", title: "Gris" },
            ],
          },
        ],
      },
    },
  });
}

async function askDelivery(to) {
  return sendText(
    to,
    "📦 Livraison Abidjan\nRéponds sous ce format :\n*Commune* + *Adresse* + *Point de repère*\nEx: Cocody, Angré 8e tranche, près de la pharmacie X"
  );
}

async function sendPaymentChoice(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Mode de paiement ?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "PAY_CASH", title: "💵 Cash" } },
          { type: "reply", reply: { id: "PAY_MOMO", title: "📲 Mobile Money" } },
        ],
      },
    },
  });
}

async function sendConfirm(to, s) {
  const recap =
    `✅ *Récap commande Le CHOCOTO*\n` +
    `• Pack: ${s.pack}\n` +
    `• Taille: ${s.size}\n` +
    `• Couleur: ${s.color}\n` +
    `• Livraison: ${s.commune} - ${s.address}\n` +
    `• Paiement: ${s.payment}\n\n` +
    `Confirmer ?`;

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: recap },
      action: {
        buttons: [
          { type: "reply", reply: { id: "CONFIRM_YES", title: "✅ Confirmer" } },
          { type: "reply", reply: { id: "CONFIRM_EDIT", title: "✏️ Modifier" } },
        ],
      },
    },
  });
}

// --- Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// --- Webhook receiver (POST)
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from; // numéro user
    const s = getSession(from);

    // Helper: récupérer id de bouton/list
    const interactive =
      msg.type === "interactive" ? msg.interactive : null;

    const replyId =
      interactive?.button_reply?.id ||
      interactive?.list_reply?.id ||
      null;

    // 1) MENU actions
    if (replyId === "CMD") {
      s.step = "PACK";
      await sendPackChoice(from);
      return res.sendStatus(200);
    }
    if (replyId === "CAT") {
      await sendText(from, "📸 Catalogue: Vert / Bleu marine / Noir / Gris.\nDis-moi: *Commander* pour choisir ton pack.");
      await sendMenu(from);
      return res.sendStatus(200);
    }
    if (replyId === "HUM") {
      s.step = "MENU";
      await sendText(from, "👤 Un agent te répond tout de suite. En attendant, tu peux écrire: taille + couleur + commune.");
      return res.sendStatus(200);
    }

    // 2) PACK
    if (replyId?.startsWith("PACK_")) {
      s.pack = replyId.replace("PACK_", "Pack ");
      s.step = "SIZE";
      await sendSizeChoice(from);
      return res.sendStatus(200);
    }

    // 3) SIZE
    if (replyId?.startsWith("SIZE_")) {
      s.size = replyId.replace("SIZE_", "");
      s.step = "COLOR";
      await sendColorChoice(from);
      return res.sendStatus(200);
    }

    // 4) COLOR
    if (replyId?.startsWith("COL_")) {
      const map = { COL_VERT: "Vert", COL_BLEU: "Bleu marine", COL_NOIR: "Noir", COL_GRIS: "Gris" };
      s.color = map[replyId] || "Couleur";
      s.step = "DELIVERY";
      await askDelivery(from);
      return res.sendStatus(200);
    }

    // 5) DELIVERY (texte libre)
    if (s.step === "DELIVERY" && msg.type === "text") {
      // simple parsing: avant la première virgule = commune
      const body = msg.text.body.trim();
      const parts = body.split(",");
      s.commune = (parts[0] || "").trim() || "Abidjan";
      s.address = parts.slice(1).join(",").trim() || body;
      s.step = "PAYMENT";
      await sendPaymentChoice(from);
      return res.sendStatus(200);
    }

    // 6) PAYMENT
    if (replyId === "PAY_CASH" || replyId === "PAY_MOMO") {
      s.payment = replyId === "PAY_CASH" ? "Cash" : "Mobile Money";
      s.step = "CONFIRM";
      await sendConfirm(from, s);
      return res.sendStatus(200);
    }

    // 7) CONFIRM
    if (replyId === "CONFIRM_YES") {
      s.step = "MENU";
      await sendText(from, "✅ Commande confirmée !\nMerci 🤝\nUn agent te contacte pour finaliser la livraison.");
      return res.sendStatus(200);
    }
    if (replyId === "CONFIRM_EDIT") {
      // reset rapide: on recommence pack
      s.step = "PACK";
      await sendPackChoice(from);
      return res.sendStatus(200);
    }

    // Default: si premier message texte
    await sendMenu(from);
    return res.sendStatus(200);

  } catch (e) {
    console.error(e);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Bot running on :${PORT}`));
