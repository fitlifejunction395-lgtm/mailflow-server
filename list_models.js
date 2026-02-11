async function listModelsDirectly() {
    const apiKey = 'AIzaSyAhxzz09wnVyM8NzANSPB5Z4sPHyqeuhnI';
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('API Error:', data.error);
        } else {
            console.log('Available Models:');
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                    console.log(`- ${m.name}`);
                }
            });
        }
    } catch (error) {
        console.error('Fetch Error:', error.message);
    }
}

listModelsDirectly();
