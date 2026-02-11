const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testHelpMeWrite() {
    const apiKey = 'AIzaSyAhxzz09wnVyM8NzANSPB5Z4sPHyqeuhnI'; // User's key
    console.log('Testing with Key:', apiKey);

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = 'Say hello in one word.';
        console.log('Sending prompt:', prompt);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log('✅ Success! Response:', text);
    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.status) console.error('Status:', error.status);
        if (error.errorDetails) console.error('Details:', JSON.stringify(error.errorDetails, null, 2));
    }
}

testHelpMeWrite();
