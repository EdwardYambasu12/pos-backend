const { Server } = require('socket.io');
const User = require('./models/User');
const Session = require('./models/Session');

let io = null;

function ownerRoom(ownerAdminId) {
  return `owner:${ownerAdminId}`;
}

function shopRoom(shopId) {
  return `shop:${shopId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}

function initRealtime(server, corsOptions) {
  io = new Server(server, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    cors: {
      origin: corsOptions.origin,
      credentials: true,
      methods: corsOptions.methods,
    },
  });

  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const userId = String(auth.userId || '').trim();
      const sessionId = String(auth.sessionId || '').trim();

      if (!userId || !sessionId) {
        return next(new Error('Missing realtime auth credentials'));
      }

      const [user, session] = await Promise.all([
        User.findById(userId).lean(),
        Session.findById(sessionId).lean(),
      ]);

      if (!user || !user.active) {
        return next(new Error('User is not active'));
      }

      if (!session || session.userId !== userId || session.logoutTime) {
        return next(new Error('Session is not valid'));
      }

      socket.data.userId = userId;
      socket.data.shopId = user.shopId || null;
      socket.data.ownerAdminId = user.role === 'admin' ? user._id : user.ownerAdminId || user.createdBy || null;
      next();
    } catch (err) {
      next(new Error('Realtime authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.userId) {
      socket.join(userRoom(socket.data.userId));
    }

    if (socket.data.ownerAdminId) {
      socket.join(ownerRoom(socket.data.ownerAdminId));
    }

    if (socket.data.shopId) {
      socket.join(shopRoom(socket.data.shopId));
    }

    socket.emit('realtime:ready', {
      connectedAt: new Date().toISOString(),
    });
  });

  return io;
}

function emitDataChange(payload) {
  if (!io) return;

  const event = {
    eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    ts: new Date().toISOString(),
    entity: payload.entity || 'unknown',
    action: payload.action || 'updated',
    ownerAdminId: payload.ownerAdminId || null,
    shopId: payload.shopId || null,
    userId: payload.userId || null,
  };

  let emitted = false;

  if (event.ownerAdminId) {
    io.to(ownerRoom(event.ownerAdminId)).emit('data:changed', event);
    emitted = true;
  }

  if (event.shopId) {
    io.to(shopRoom(event.shopId)).emit('data:changed', event);
    emitted = true;
  }

  if (event.userId) {
    io.to(userRoom(event.userId)).emit('data:changed', event);
    emitted = true;
  }

  if (!emitted && payload.broadcast === true) {
    io.emit('data:changed', event);
  }
}

module.exports = {
  initRealtime,
  emitDataChange,
};
