import 'package:flutter/material.dart';

class PrinterSettingsScreen extends StatelessWidget {
  const PrinterSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Printer Settings')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.print_outlined, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text(
              'Bluetooth Printer ချိတ်ဆက်မှုကို\nနောက်ထပ် version တွင် ထည့်သွင်းမည်',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, color: Colors.grey),
            ),
          ]),
        ),
      ),
    );
  }
}
