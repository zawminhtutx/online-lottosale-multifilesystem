import 'package:flutter/material.dart';
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  // This widget is the root of your application.
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
      ),
      home: const AdvancedOCRScreen(),
    );
  }
}

class AdvancedOCRScreen extends StatefulWidget {
  const AdvancedOCRScreen({super.key});

  @override
  // ignore: library_private_types_in_public_api
  _AdvancedOCRScreenState createState() => _AdvancedOCRScreenState();
}

class _AdvancedOCRScreenState extends State<AdvancedOCRScreen> {
  File? _selectedImage;
  String _extractedText = "ပုံရွေးချယ်ပြီး စာသားထုတ်ယူပါ...";
  bool _isLoading = false;

  Future<void> _pickImageFromGallery() async {
    final picker = ImagePicker();
    final pickedFile = await picker.pickImage(source: ImageSource.gallery);

    if (pickedFile != null) {
      setState(() {
        _selectedImage = File(pickedFile.path);
        _isLoading = true;
      });
      _recognizeAndFilterText(_selectedImage!);
    }
  }

  Future<void> _recognizeAndFilterText(File imageFile) async {
    final inputImage = InputImage.fromFile(imageFile);

    // --- ပြင်ဆင်ချက် - မြန်မာစာလုံးနှင့် အခြားပုံစံများပါ ဖတ်နိုင်ရန် devanagari script သို့ ပြောင်းလဲခြင်း ---
    final textRecognizer = TextRecognizer(script: TextRecognitionScript.latin);

    try {
      final RecognizedText recognizedText = await textRecognizer.processImage(
        inputImage,
      );

      if (recognizedText.text.isNotEmpty) {
        List<String> lines = recognizedText.text.split('\n');
        List<String> finalFilteredList = [];

        // အဆင့်မြင့် RegExp စုစည်းမှု
        List<RegExp> patterns = [
          RegExp(r'\d+[\d\-\./]*[rR@bB]\s*\d+'), // 45r5000, 53-56@300, 0b2000
          RegExp(r'\d+/\d+-\d+[rR]\d+'), // 47/25-300r1000
          RegExp(r'\d+@\d+(?:/\d+@\d+)*'), // 56@1150/70@600
          RegExp(r'\d+(?:[=\-\.\/]\d+)+@\d+'), // 20=90-26-97@200
          RegExp(r'\d+/\d+'), // 00/5000, 55/8000
          RegExp(r'\d+[\s/]*[0-9]*[bB]\s*-\s*\d+'), // 7/0B-750, 0B-150
          // ၁။ မြန်မာစာလုံး (ထိပ်၊ ပါ၊ ခွေပူး) ပါလာလျှင် ဖမ်းယူရန်
          RegExp(r'\d+[\u1000-\u109F]+\d+.*'),

          // ၂။ (အရေးကြီး) အကယ်၍ OCR က မြန်မာစာလုံးကို အင်္ဂလိပ်စာလုံး သို့မဟုတ် သင်္ကေတများဖြင့် မှားဖတ်ခဲ့လျှင်လည်း ဖမ်းယူရန်
          // ဥပမာ - 9ထိပ်2000 ကို 9oo2000 သို့မဟုတ် 9od2000 ဟု ဖတ်မိပါကလည်း ပါဝင်စေမည်
          RegExp(r'\d+[a-zA-Z]{1,4}\d+\s*[rR@bB]?\s*\d*'),
        ];

        for (String line in lines) {
          String cleanLine = line.trim();

          // မလိုအပ်သော စာသားများနှင့် အချိန်များကို ဖျက်ထုတ်ခြင်း
          if (cleanLine.contains("Translate") ||
              cleanLine.contains("Forwarded") ||
              RegExp(r'\d{1,2}:\d{2}\s*(?:AM|PM)?').hasMatch(cleanLine) ||
              cleanLine.length <= 1) {
            continue;
          }

          bool isMatch = false;
          for (var pattern in patterns) {
            if (pattern.hasMatch(cleanLine)) {
              isMatch = true;
              break;
            }
          }

          if (isMatch) {
            finalFilteredList.add(cleanLine);
          }
        }

        setState(() {
          _extractedText = finalFilteredList.isNotEmpty
              ? finalFilteredList.join('\n')
              : "လိုချင်သော အရောင်းစာရင်း ပုံစံများမတွေ့ပါ။";
        });
      } else {
        setState(() {
          _extractedText = "ပုံထဲတွင် မည်သည့်စာသားမျှ မတွေ့ပါ။";
        });
      }
    } catch (e) {
      setState(() {
        _extractedText = "Error: $e";
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
      textRecognizer.close();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text("2D/3D Data Filter OCR")),
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            children: [
              _selectedImage != null
                  ? Image.file(_selectedImage!, height: 250)
                  : Container(
                      height: 250,
                      color: Colors.grey[200],
                      child: Icon(
                        Icons.image_search,
                        size: 60,
                        color: Colors.grey,
                      ),
                    ),
              SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: _pickImageFromGallery,
                icon: Icon(Icons.photo_library),
                label: Text("ဓာတ်ပုံရွေးပြီး စာရင်းထုတ်မည်"),
              ),
              SizedBox(height: 25),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  "စစ်ထုတ်ပြီးသား စာရင်းများ -",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              SizedBox(height: 10),
              _isLoading
                  ? CircularProgressIndicator()
                  : Container(
                      width: double.infinity,
                      padding: EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.green[50],
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.green[200]!),
                      ),
                      child: SelectionArea(
                        child: Text(
                          _extractedText,
                          style: TextStyle(
                            fontSize: 18,
                            color: Colors.black87,
                            height: 1.5,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ),
            ],
          ),
        ),
      ),
    );
  }
}
