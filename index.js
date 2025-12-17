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

if (!VERIFY_TOKEN || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.log("❌ Missing env vars:", {
    VERIFY_TOKEN: !!VERIFY_TOKEN,
    WHATSAPP_TOKEN: !!WHATSAPP_TOKEN,
    PHONE_NUMBER_ID: !!PHONE_NUMBER_ID,
  });
}

const WA_API = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

// --- mini “DB” en mémoire (remplace par Redis en prod)
const sessions = new Map();

function getSession(from) {
  if (!sessions.has(from)) sessions.set(from, { step: "MENU" });
  return sessions.get(from);
}

async function sendMessage(payload) {
  try {
    const r = await axios.post(WA_API, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    return r.data;
  } catch (e) {
    // 🔥 Log clair de l’erreur d’envoi WhatsApp
    console.error("❌ WhatsApp send error:", e?.response?.data || e.message);
    throw e;
  }
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

// --- Webhook verification (GET) (UN SEUL)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Webhook receiver (POST)
// IMPORTANT : on ACK tout de suite, puis on traite après
app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  (async () => {
    try {
      console.log("📩 Webhook reçu:", JSON.stringify(req.body, null, 2));

      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const msg = change?.messages?.[0];

      if (!msg) {
        console.log("ℹ️ Pas de message (probablement un status update).");
        return;
      }

      const from = msg.from;
      const s = getSession(from);

      const interactive = msg.type === "interactive" ? msg.interactive : null;
      const replyId =
        interactive?.button_reply?.id ||
        interactive?.list_reply?.id ||
        null;

      console.log("✅ From:", from, "type:", msg.type, "replyId:", replyId);

      // MENU
      if (replyId === "CMD") {
        s.step = "PACK";
        await sendPackChoice(from);
        return;
      }
      if (replyId === "CAT") {
        await sendText(from, "📸 Catalogue: Vert / Bleu marine / Noir / Gris.\nDis-moi: *Commander* pour choisir ton pack.");
        await sendMenu(from);
        return;
      }
      if (replyId === "HUM") {
        s.step = "MENU";
        await sendText(from, "👤 Un agent te répond tout de suite. En attendant, tu peux écrire: taille + couleur + commune.");
        return;
      }

      // PACK
      if (replyId?.startsWith("PACK_")) {
        s.pack = replyId.replace("PACK_", "Pack ");
        s.step = "SIZE";
        await sendSizeChoice(from);
        return;
      }

      // SIZE
      if (replyId?.startsWith("SIZE_")) {
        s.size = replyId.replace("SIZE_", "");
        s.step = "COLOR";
        await sendColorChoice(from);
        return;
      }

      // COLOR
      if (replyId?.startsWith("COL_")) {
        const map = { COL_VERT: "Vert", COL_BLEU: "Bleu marine", COL_NOIR: "Noir", COL_GRIS: "Gris" };
        s.color = map[replyId] || "Couleur";
        s.step = "DELIVERY";
        await askDelivery(from);
        return;
      }

      // DELIVERY texte libre
      if (s.step === "DELIVERY" && msg.type === "text") {
        const body = msg.text.body.trim();
        const parts = body.split(",");
        s.commune = (parts[0] || "").trim() || "Abidjan";
        s.address = parts.slice(1).join(",").trim() || body;
        s.step = "PAYMENT";
        await sendPaymentChoice(from);
        return;
      }

      // PAYMENT
      if (replyId === "PAY_CASH" || replyId === "PAY_MOMO") {
        s.payment = replyId === "PAY_CASH" ? "Cash" : "Mobile Money";
        s.step = "CONFIRM";
        await sendConfirm(from, s);
        return;
      }

      // CONFIRM
      if (replyId === "CONFIRM_YES") {
        s.step = "MENU";
        await sendText(from, "✅ Commande confirmée !\nMerci 🤝\nUn agent te contacte pour finaliser la livraison.");
        return;
      }
      if (replyId === "CONFIRM_EDIT") {
        s.step = "PACK";
        await sendPackChoice(from);
        return;
      }

      // Default: premier message texte
      await sendMenu(from);
    } catch (e) {
      console.error("❌ Processing error:", e?.response?.data || e.message || e);
    }
  })();
});

app.listen(PORT, () => console.log(`✅ Bot running on :${PORT}`));
