import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnect?: boolean;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: any) => void;
}

interface UseWebSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  data: any;
  error: any;
  send: (event: string, data?: any) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(
  namespace: string,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const {
    autoConnect = true,
    reconnect = true,
    onMessage,
    onConnect,
    onDisconnect,
    onError
  } = options;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (socket?.connected) return;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
      const newSocket = io(`${baseUrl}${namespace}`, {
        transports: ['websocket'],
        upgrade: true,
        rememberUpgrade: true
      });

      newSocket.on('connect', () => {
        console.log(`Connected to WebSocket namespace: ${namespace}`);
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      });

      newSocket.on('disconnect', (reason) => {
        console.log(`Disconnected from WebSocket namespace: ${namespace}`, reason);
        setIsConnected(false);
        onDisconnect?.();

        // Auto-reconnect if enabled and disconnection wasn't intentional
        if (reconnect && reason !== 'io client disconnect' && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(`Attempting to reconnect in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      });

      newSocket.on('connect_error', (err) => {
        console.error(`WebSocket connection error for ${namespace}:`, err);
        setError(err);
        setIsConnected(false);
        onError?.(err);
      });

      // Generic message handler
      newSocket.onAny((event, data) => {
        console.log(`WebSocket message received on ${namespace}:`, event, data);
        setData({ type: event, ...data });
        onMessage?.(data);
      });

      setSocket(newSocket);
    } catch (err) {
      console.error(`Failed to create WebSocket connection for ${namespace}:`, err);
      setError(err);
      onError?.(err);
    }
  }, [namespace, reconnect, onConnect, onDisconnect, onError, onMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
    }
  }, [socket]);

  const send = useCallback((event: string, data?: any) => {
    if (socket?.connected) {
      socket.emit(event, data);
    } else {
      console.warn('WebSocket not connected. Cannot send message:', event, data);
    }
  }, [socket]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    socket,
    isConnected,
    data,
    error,
    send,
    connect,
    disconnect
  };
}