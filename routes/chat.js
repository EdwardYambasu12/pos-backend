const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const ChatMessage = require('../models/ChatMessage');
const ChatReadState = require('../models/ChatReadState');

function scopeKey(shopId) {
  return shopId || 'all';
}

function getGroupConversationId(ownerAdminId) {
  return `cashier-group:${ownerAdminId || 'unknown'}`;
}

function resolveConversationId(message) {
  if (message.conversationId) {
    return message.conversationId;
  }

  return getGroupConversationId(message.ownerAdminId);
}

function normalize({ _id, ...rest }) {
  return { id: String(_id), ...rest };
}

router.get('/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const filter = {};

    if (req.query.conversationId) {
      filter.conversationId = req.query.conversationId;
    }

    if (req.query.threadType) {
      filter.threadType = req.query.threadType;
    }

    if (req.query.ownerAdminId) {
      filter.ownerAdminId = req.query.ownerAdminId;
    }

    if (req.query.shopId && !req.query.conversationId) {
      filter.shopId = req.query.shopId;
    }

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    return res.json(messages.map((message) => ({
      ...normalize(message),
      conversationId: resolveConversationId(message),
    })));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const { ownerAdminId, shopId, userId } = req.query;
    if (!ownerAdminId || !userId) {
      return res.status(400).json({ error: 'ownerAdminId and userId are required' });
    }

    const filter = { ownerAdminId };
    if (shopId) {
      filter.$or = [
        { threadType: 'cashier_dm' },
        { threadType: 'cashier_group' },
        { threadType: 'cashier', shopId },
      ];
    } else {
      filter.threadType = { $in: ['cashier', 'cashier_group', 'cashier_dm'] };
    }

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    const conversationMap = new Map();
    for (const message of messages) {
      const conversationId = resolveConversationId(message);
      if (!conversationMap.has(conversationId)) {
        conversationMap.set(conversationId, {
          conversationId,
          threadType: message.threadType === 'cashier' ? 'cashier_group' : message.threadType,
          lastMessage: normalize(message),
          unreadCount: 0,
          recipientUserId: message.recipientUserId || null,
          shopId: message.shopId || null,
        });
      }
    }

    const conversationIds = Array.from(conversationMap.keys());
    if (!conversationIds.length) {
      return res.json([]);
    }

    const readStates = await ChatReadState.find({
      userId,
      conversationId: { $in: conversationIds },
    }).lean();

    const readMap = new Map(readStates.map((state) => [state.conversationId, state.lastReadAt]));

    for (const [conversationId, item] of conversationMap.entries()) {
      const lastReadAt = readMap.get(conversationId);
      const unreadCount = messages.filter((message) => {
        const msgConversationId = resolveConversationId(message);
        if (msgConversationId !== conversationId) return false;
        if (message.senderUserId === userId) return false;
        if (!lastReadAt) return true;
        return new Date(message.createdAt).getTime() > new Date(lastReadAt).getTime();
      }).length;

      item.unreadCount = unreadCount;
    }

    return res.json(Array.from(conversationMap.values()));
  } catch {
    return res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

router.post('/messages', async (req, res) => {
  const {
    threadType,
    conversationId,
    text,
    senderUserId,
    senderName,
    senderRole,
    recipientUserId,
    ownerAdminId,
    shopId,
  } = req.body;

  if (!threadType || !text || !senderUserId || !senderName || !senderRole) {
    return res.status(400).json({
      error: 'threadType, text, senderUserId, senderName, and senderRole are required',
    });
  }

  if (!['cashier', 'cashier_group', 'cashier_dm'].includes(threadType)) {
    return res.status(400).json({ error: 'Invalid threadType' });
  }

  try {
    const created = await ChatMessage.create({
      _id: uuidv4(),
      threadType,
      conversationId: conversationId || getGroupConversationId(ownerAdminId),
      text: String(text).trim(),
      senderUserId,
      senderName,
      senderRole,
      recipientUserId: recipientUserId || null,
      ownerAdminId: ownerAdminId || null,
      shopId: shopId || null,
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json(normalize(created.toObject()));
  } catch {
    return res.status(500).json({ error: 'Failed to send chat message' });
  }
});

router.post('/read', async (req, res) => {
  const { conversationId, userId, ownerAdminId, shopId } = req.body;
  if (!conversationId || !userId) {
    return res.status(400).json({ error: 'conversationId and userId are required' });
  }

  try {
    const existing = await ChatReadState.findOne({ userId, conversationId });
    const now = new Date().toISOString();

    if (existing) {
      existing.lastReadAt = now;
      await existing.save();
      return res.json(normalize(existing.toObject()));
    }

    const created = await ChatReadState.create({
      _id: uuidv4(),
      userId,
      conversationId,
      lastReadAt: now,
      ownerAdminId: ownerAdminId || null,
      shopId: shopId || null,
    });

    return res.status(201).json(normalize(created.toObject()));
  } catch {
    return res.status(500).json({ error: 'Failed to update read status' });
  }
});

module.exports = router;
