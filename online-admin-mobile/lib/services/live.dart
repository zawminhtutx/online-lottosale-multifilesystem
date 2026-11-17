import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'api.dart';

// Live change notices from the server's WebSocket (/ws?token=...): {type: 'tickets'|'terms'|
// 'wallet-requests', term_id?}. Screens listen for a type and reload. The socket opens with the
// first listener, reconnects with backoff, and on reconnect tells every listener to reload.
class Live {
  Live._();
  static final Live instance = Live._();

  final _listeners = <({String type, void Function(Map msg) fn})>[];
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _retryTimer;
  int _retry = 0;
  final connected = StreamController<bool>.broadcast();
  bool isConnected = false;

  // Returns a function that removes the listener.
  void Function() listen(String type, void Function(Map msg) fn) {
    final l = (type: type, fn: fn);
    _listeners.add(l);
    _connect();
    return () {
      _listeners.remove(l);
      if (_listeners.isEmpty) stop();
    };
  }

  void _setConnected(bool v) {
    isConnected = v;
    connected.add(v);
  }

  void _connect() {
    if (_channel != null || _listeners.isEmpty || Api.instance.token == null) return;
    _retryTimer?.cancel();
    final base = Uri.parse(Api.instance.server);
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '/ws',
      queryParameters: {'token': Api.instance.token!},
    );
    final ch = WebSocketChannel.connect(uri);
    _channel = ch;
    ch.ready.then((_) {
      if (_channel != ch) return;
      _setConnected(true);
      if (_retry > 0) {
        for (final l in [..._listeners]) {
          l.fn({'type': l.type, 'reconnected': true});
        }
      }
      _retry = 0;
    }).catchError((_) {});
    _sub = ch.stream.listen(
      (data) {
        Map msg;
        try {
          msg = jsonDecode('$data') as Map;
        } catch (_) {
          return;
        }
        for (final l in [..._listeners]) {
          if (l.type == msg['type']) l.fn(msg);
        }
      },
      onDone: () => _dropped(ch),
      onError: (_) => _dropped(ch),
      cancelOnError: true,
    );
  }

  void _dropped(WebSocketChannel ch) {
    if (_channel != ch) return;
    _channel = null;
    _sub?.cancel();
    _setConnected(false);
    if (_listeners.isEmpty || ch.closeCode == 4401) return;
    _retry++;
    final wait = Duration(seconds: [1 << (_retry > 5 ? 5 : _retry), 30].reduce((a, b) => a < b ? a : b));
    _retryTimer = Timer(wait, _connect);
  }

  void stop() {
    _retryTimer?.cancel();
    _retry = 0;
    final ch = _channel;
    _channel = null;
    _sub?.cancel();
    ch?.sink.close();
    if (isConnected) _setConnected(false);
  }
}
