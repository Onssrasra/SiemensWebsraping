const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Für lokale Entwicklung deaktiviert
}));
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files

class SiemensProductScraper {
    constructor() {
        this.baseUrl = "https://www.mymobase.com/de/p/";
        this.browser = null;
    }

    async initBrowser() {
        if (!this.browser) {
            console.log('Starte Browser...');
            try {
                this.browser = await chromium.launch({
                    headless: true,
                    args: [
                        '--no-sandbox', 
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor',
                        '--disable-extensions',
                        '--disable-plugins',
                        '--disable-images',
                        '--disable-javascript',
                        '--disable-gpu',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-field-trial-config',
                        '--disable-ipc-flooding-protection'
                    ]
                });
            } catch (error) {
                console.error('Browser-Start fehlgeschlagen:', error.message);
                
                // Versuche Browser zu installieren und erneut zu starten
                console.log('Versuche Browser-Installation...');
                try {
                    execSync('npx playwright install chromium', { stdio: 'inherit' });
                    
                    this.browser = await chromium.launch({
                        headless: true,
                        args: [
                            '--no-sandbox', 
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-web-security',
                            '--disable-features=VizDisplayCompositor',
                            '--disable-extensions',
                            '--disable-plugins',
                            '--disable-images',
                            '--disable-javascript',
                            '--disable-gpu',
                            '--disable-background-timer-throttling',
                            '--disable-backgrounding-occluded-windows',
                            '--disable-renderer-backgrounding',
                            '--disable-field-trial-config',
                            '--disable-ipc-flooding-protection'
                        ]
                    });
                    console.log('Browser erfolgreich installiert und gestartet');
                } catch (installError) {
                    console.error('Browser-Installation fehlgeschlagen:', installError.message);
                    throw new Error('Browser konnte nicht installiert werden. Bitte führen Sie "npm run install-browsers" manuell aus.');
                }
            }
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async scrapeProduct(articleNumber) {
        const url = `${this.baseUrl}${articleNumber}`;
        const result = {
            Herstellerartikelnummer: articleNumber,
            Artikelnummer: articleNumber,
            URL: url,
            Produkttitel: "Nicht gefunden",
            Produktbeschreibung: "Nicht gefunden",
            Werkstoff: "Nicht gefunden",
            "Weitere Artikelnummer": "Nicht gefunden",
            Abmessung: "Nicht gefunden",
            Gewicht: "Nicht gefunden",
            Materialklassifizierung: "Nicht gefunden",
            "Materialklassifizierung Bewertung": "Nicht bewertet",
            "Statistische Warennummer": "Nicht gefunden",
            Produktlink: url,
            Ursprungsland: "Nicht gefunden",
            Plattformen: "Nicht gefunden",
            Verfügbarkeit: "Unbekannt",
            Status: "Wird verarbeitet...",
            scrapeTime: new Date().toISOString()
        };

        try {
            const browser = await this.initBrowser();
            const page = await browser.newPage();
            
            // Optimierte Browser-Konfiguration für schnellere Performance
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            });

            // Deaktiviere unnötige Ressourcen für schnellere Ladezeiten
            await page.route('**/*', (route) => {
                const resourceType = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            console.log(`Lade Seite: ${url}`);
            
            // Reduzierte Wartezeit und optimierte Lade-Strategie
            const response = await page.goto(url, { 
                waitUntil: 'domcontentloaded', // Schneller als 'networkidle'
                timeout: 15000 // Reduziert von 30s auf 15s
            });

            if (!response) {
                result.Status = "Keine Antwort vom Server";
                return result;
            }

            if (response.status() === 404) {
                result.Status = "Produkt nicht gefunden (404)";
                return result;
            } else if (response.status() !== 200) {
                result.Status = `HTTP-Fehler: ${response.status()}`;
                return result;
            }

            // Reduzierte Wartezeit
            await page.waitForTimeout(500); // Reduziert von 2s auf 0.5s

            // Schnelle Extraktion der wichtigsten Daten
            await this.extractBasicInfo(page, result);
            
            // Nur wenn wichtige Daten fehlen, verwende aufwändigere Methoden
            if (this.needsMoreData(result)) {
                await this.extractTechnicalData(page, result);
                
                if (this.needsMoreData(result)) {
                    await this.extractFromInitialData(page, result);
                }
            }

            // Finale Bewertung
            const hasData = result.Werkstoff !== "Nicht gefunden" || 
                          result.Materialklassifizierung !== "Nicht gefunden" ||
                          result.Gewicht !== "Nicht gefunden" ||
                          result.Abmessung !== "Nicht gefunden";
            
            if (hasData) {
                result.Status = "Erfolgreich";
                console.log('Scraping erfolgreich - Daten gefunden');
            } else {
                result.Status = "Teilweise erfolgreich - Wenig Daten gefunden";
                console.log('Scraping unvollständig - Wenig Daten extrahiert');
            }
            
            await page.close();
            
        } catch (error) {
            console.error('Scraping Fehler:', error);
            result.Status = `Fehler: ${error.message}`;
            result.Produkttitel = "Scraping fehlgeschlagen";
        }

        return result;
    }

    async extractBasicInfo(page, result) {
        try {
            // Schnelle Extraktion der wichtigsten Informationen
            const title = await page.title();
            if (title && !title.includes('404') && !title.includes('Not Found')) {
                result.Produkttitel = title.replace(" | MoBase", "").trim();
            }

            // Meta-Beschreibung
            const metaDesc = await page.getAttribute('meta[name="description"]', 'content');
            if (metaDesc) {
                result.Produktbeschreibung = metaDesc;
            }
        } catch (e) {
            console.log('Grundlegende Info-Extraktion fehlgeschlagen:', e.message);
        }
    }

    needsMoreData(result) {
        return result.Werkstoff === "Nicht gefunden" || 
               result.Materialklassifizierung === "Nicht gefunden" || 
               result['Statistische Warennummer'] === "Nicht gefunden" ||
               result.Gewicht === "Nicht gefunden" ||
               result.Abmessung === "Nicht gefunden";
    }

    async extractTechnicalData(page, result) {
        try {
            // Optimierte Extraktion mit effizienteren Selektoren
            const technicalData = await page.evaluate(() => {
                const data = {};
                
                // Schnelle Tabellen-Extraktion
                const tables = document.querySelectorAll('table');
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, th');
                        if (cells.length >= 2) {
                            const key = cells[0].textContent.trim().toLowerCase();
                            const value = cells[1].textContent.trim();
                            if (key && value) {
                                data[key] = value;
                            }
                        }
                    });
                });

                // Schnelle Div-Extraktion für Spezifikationen
                const specDivs = document.querySelectorAll('[class*="spec"], [class*="detail"], [class*="info"]');
                specDivs.forEach(div => {
                    const text = div.textContent;
                    if (text && text.includes(':')) {
                        const lines = text.split('\n');
                        lines.forEach(line => {
                            const colonIndex = line.indexOf(':');
                            if (colonIndex > 0) {
                                const key = line.substring(0, colonIndex).trim().toLowerCase();
                                const value = line.substring(colonIndex + 1).trim();
                                if (key && value && !data[key]) {
                                    data[key] = value;
                                }
                            }
                        });
                    }
                });

                return data;
            });

            // Mappe die extrahierten Daten
            Object.entries(technicalData).forEach(([key, value]) => {
                this.mapTechnicalField(key, value, result);
            });

        } catch (error) {
            console.log('Technische Daten Extraktion Fehler:', error.message);
        }
    }

    async extractProductDetails(page, result) {
        // Common selectors for product information
        const selectors = {
            title: ['h1', '.product-title', '.title', '[data-testid="product-title"]'],
            description: ['.description', '.product-description', '.details'],
            weight: ['[data-testid="weight"]', '.weight', '[class*="weight"]'],
            dimensions: ['[data-testid="dimensions"]', '.dimensions', '[class*="dimension"]'],
            material: ['.material', '[data-testid="material"]', '[class*="material"]'],
            availability: ['.availability', '.stock', '[data-testid="availability"]']
        };

        for (const [field, selectorList] of Object.entries(selectors)) {
            for (const selector of selectorList) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const text = await element.innerText();
                        if (text && text.trim()) {
                            this.mapProductField(field, text.trim(), result);
                            break; // Found content for this field
                        }
                    }
                } catch (e) {
                    // Continue to next selector
                }
            }
        }
    }

    mapTechnicalField(key, value, result) {
        console.log(`Table-Field Mapping: "${key}" = "${value}"`);
        
        // EXAKTE REIHENFOLGE WIE IN DEINEM PYTHON CODE - Spezifische Felder ZUERST!
        if (key.includes('abmessung') || key.includes('größe') || key.includes('dimension')) {
            result.Abmessung = this.interpretDimensions(value);
            console.log(`Abmessung aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('gewicht') && !key.includes('einheit')) {
            result.Gewicht = value;
            console.log(`Gewicht aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('werkstoff') && !key.includes('klassifizierung')) {
            // NUR exakte "werkstoff" Übereinstimmung, NICHT bei "materialklassifizierung"
            result.Werkstoff = value;
            console.log(`Werkstoff aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('weitere artikelnummer') || key.includes('additional article number') || key.includes('part number')) {
            result["Weitere Artikelnummer"] = value;
            console.log(`Weitere Artikelnummer aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('materialklassifizierung') || key.includes('material classification')) {
            result.Materialklassifizierung = value;
            console.log(`Materialklassifizierung aus Tabelle zugeordnet: ${value}`);
            if (value.toLowerCase().includes('nicht schweiss')) {
                result["Materialklassifizierung Bewertung"] = "OHNE/N/N/N/N";
            }
        } else if (key.includes('statistische warennummer') || key.includes('statistical') || key.includes('import')) {
            result["Statistische Warennummer"] = value;
            console.log(`Statistische Warennummer aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('ursprungsland') || key.includes('origin')) {
            result.Ursprungsland = value;
            console.log(`Ursprungsland aus Tabelle zugeordnet: ${value}`);
        } else if (key.includes('verfügbar') || key.includes('stock') || key.includes('lager')) {
            result.Verfügbarkeit = value;
        } else {
            console.log(`Unbekannter Table-Schlüssel: "${key}" = "${value}"`);
        }
    }

    mapProductField(field, value, result) {
        switch (field) {
            case 'title':
                if (!result.Produkttitel || result.Produkttitel === "Nicht gefunden") {
                    result.Produkttitel = value;
                }
                break;
            case 'description':
                if (!result.Produktbeschreibung || result.Produktbeschreibung === "Nicht gefunden") {
                    result.Produktbeschreibung = value;
                }
                break;
            case 'weight':
                result.Gewicht = value;
                break;
            case 'dimensions':
                result.Abmessung = this.interpretDimensions(value);
                break;
            case 'material':
                result.Werkstoff = value;
                break;
            case 'availability':
                result.Verfügbarkeit = value;
                break;
        }
    }

    parseSpecificationText(text, result) {
        const lines = text.split('\n');
        
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim().toLowerCase();
                const value = line.substring(colonIndex + 1).trim();
                
                if (key && value) {
                    this.mapTechnicalField(key, value, result);
                }
            }
        }
    }

    interpretDimensions(text) {
        if (!text) return "Nicht gefunden";
        
        const cleanText = text.replace(/\s+/g, '').toLowerCase();
        
        // Check for diameter x height pattern
        if (cleanText.includes('⌀') || cleanText.includes('ø')) {
            const match = cleanText.match(/[⌀ø]?(\d+)[x×](\d+)/);
            if (match) {
                return `Durchmesser×Höhe: ${match[1]}×${match[2]} mm`;
            }
        }
        
        // Check for L x B x H pattern
        const lbhMatch = cleanText.match(/(\d+)[x×](\d+)[x×](\d+)/);
        if (lbhMatch) {
            return `L×B×H: ${lbhMatch[1]}×${lbhMatch[2]}×${lbhMatch[3]} mm`;
        }
        
        // Check for L x B pattern
        const lbMatch = cleanText.match(/(\d+)[x×](\d+)/);
        if (lbMatch) {
            return `L×B: ${lbMatch[1]}×${lbMatch[2]} mm`;
        }
        
        return text;
    }

    async extractFromInitialData(page, result) {
        try {
            console.log('Extrahiere Daten aus window.initialData...');
            
            // Optimierte Extraktion mit effizienterer JavaScript-Ausführung
            const productData = await page.evaluate(() => {
                try {
                    const initialData = window.initialData;
                    if (!initialData || !initialData['product/dataProduct']) {
                        return null;
                    }
                    
                    const productInfo = initialData['product/dataProduct'].data.product;
                    const extractedData = {
                        name: productInfo.name || '',
                        description: productInfo.description || '',
                        url: productInfo.url || '',
                        technicalSpecs: [],
                        directProperties: {
                            weight: productInfo.weight || '',
                            dimensions: productInfo.dimensions || '',
                            basicMaterial: productInfo.basicMaterial || '',
                            materialClassification: productInfo.materialClassification || '',
                            importCodeNumber: productInfo.importCodeNumber || '',
                            additionalMaterialNumbers: productInfo.additionalMaterialNumbers || ''
                        }
                    };
                    
                    // Schnelle Extraktion der technischen Spezifikationen
                    if (productInfo.localizations && productInfo.localizations.technicalSpecifications) {
                        extractedData.technicalSpecs = productInfo.localizations.technicalSpecifications;
                    }
                    
                    return extractedData;
                } catch (e) {
                    return null;
                }
            });

            if (productData) {
                console.log('Produktdaten aus initialData gefunden');
                
                // Schnelle Mapping der Daten
                if (productData.name) result.Produkttitel = productData.name;
                if (productData.description) result.Produktbeschreibung = productData.description;
                if (productData.url) result.Produktlink = `https://www.mymobase.com${productData.url}`;
                
                // Optimierte Mapping der technischen Spezifikationen
                if (productData.technicalSpecs && productData.technicalSpecs.length > 0) {
                    productData.technicalSpecs.forEach(spec => {
                        const key = spec.key.toLowerCase().trim();
                        const value = spec.value;
                        
                        if (key.includes('materialklassifizierung') && result.Materialklassifizierung === "Nicht gefunden") {
                            result.Materialklassifizierung = value;
                        } else if (key.includes('statistische warennummer') && result['Statistische Warennummer'] === "Nicht gefunden") {
                            result['Statistische Warennummer'] = value;
                        } else if (key.includes('weitere artikelnummer') && result['Weitere Artikelnummer'] === "Nicht gefunden") {
                            result['Weitere Artikelnummer'] = value;
                        } else if (key.includes('abmessungen') && result.Abmessung === "Nicht gefunden") {
                            result.Abmessung = value;
                        } else if (key.includes('gewicht') && result.Gewicht === "Nicht gefunden") {
                            result.Gewicht = value;
                        } else if (key.includes('werkstoff') && result.Werkstoff === "Nicht gefunden") {
                            result.Werkstoff = value;
                        }
                    });
                }
                
                // Fallback auf direkte Eigenschaften
                const direct = productData.directProperties;
                if (result.Gewicht === "Nicht gefunden" && direct.weight) {
                    result.Gewicht = direct.weight.toString();
                }
                if (result.Abmessung === "Nicht gefunden" && direct.dimensions) {
                    result.Abmessung = direct.dimensions;
                }
                if (result.Werkstoff === "Nicht gefunden" && direct.basicMaterial) {
                    result.Werkstoff = direct.basicMaterial;
                }
                if (result.Materialklassifizierung === "Nicht gefunden" && direct.materialClassification) {
                    result.Materialklassifizierung = direct.materialClassification;
                }
                if (result['Statistische Warennummer'] === "Nicht gefunden" && direct.importCodeNumber) {
                    result['Statistische Warennummer'] = direct.importCodeNumber;
                }
                if (result['Weitere Artikelnummer'] === "Nicht gefunden" && direct.additionalMaterialNumbers) {
                    result['Weitere Artikelnummer'] = direct.additionalMaterialNumbers;
                }
            }
            
        } catch (error) {
            console.log('Fehler bei initialData Extraktion:', error.message);
        }
    }

    async extractFromHTML(page, result) {
        try {
            console.log('🔍 Extrahiere Daten direkt aus HTML DOM...');
            
            // Extract technical specifications from HTML tables/divs
            const htmlData = await page.evaluate(() => {
                const data = {};
                
                // Look for various table structures
                const tables = document.querySelectorAll('table');
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, th');
                        if (cells.length >= 2) {
                            const key = cells[0].textContent.trim().toLowerCase();
                            const value = cells[1].textContent.trim();
                            
                            if (key && value && value !== '-' && value !== '') {
                                data[key] = value;
                            }
                        }
                    });
                });
                
                // Look for definition lists
                const dls = document.querySelectorAll('dl');
                dls.forEach(dl => {
                    const dts = dl.querySelectorAll('dt');
                    const dds = dl.querySelectorAll('dd');
                    
                    for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
                        const key = dts[i].textContent.trim().toLowerCase();
                        const value = dds[i].textContent.trim();
                        
                        if (key && value && value !== '-' && value !== '') {
                            data[key] = value;
                        }
                    }
                });
                
                // Look for specific classes or data attributes
                const specElements = document.querySelectorAll('[class*="spec"], [class*="detail"], [data-spec]');
                specElements.forEach(element => {
                    const text = element.textContent;
                    if (text.includes(':')) {
                        const parts = text.split(':');
                        if (parts.length >= 2) {
                            const key = parts[0].trim().toLowerCase();
                            const value = parts.slice(1).join(':').trim();
                            if (key && value && value !== '-' && value !== '') {
                                data[key] = value;
                            }
                        }
                    }
                });
                
                return data;
            });
            
            console.log('📊 HTML-Extraktion gefunden:', Object.keys(htmlData));
            
            // Map HTML data to result fields
            Object.entries(htmlData).forEach(([key, value]) => {
                if (key.includes('weitere artikelnummer') && !result['Weitere Artikelnummer']) {
                    result['Weitere Artikelnummer'] = value;
                } else if (key.includes('abmess') && !result.Abmessung) {
                    result.Abmessung = value;
                } else if (key.includes('gewicht') && !result.Gewicht) {
                    result.Gewicht = value;
                } else if (key.includes('werkstoff') && !result.Werkstoff) {
                    result.Werkstoff = value;
                } else if (key.includes('materialklassifizierung') && !result.Materialklassifizierung) {
                    result.Materialklassifizierung = value;
                } else if (key.includes('statistische warennummer') && !result['Statistische Warennummer']) {
                    result['Statistische Warennummer'] = value;
                }
            });
            
        } catch (error) {
            console.log('⚠️ Fehler bei HTML-Extraktion:', error.message);
        }
    }

    interpretMaterialClassification(classification) {
        if (!classification) return "Nicht bewertet";
        
        const lower = classification.toLowerCase();
        
        if (lower.includes('nicht schweiss') && lower.includes('guss') && lower.includes('klebe') && lower.includes('schmiede')) {
            return "OHNE/N/N/N/N - Material ist nicht schweißbar, gießbar, klebbar oder schmiedbar";
        }
        
        if (lower.includes('nicht schweiss')) {
            return "Nicht schweißbar - Material kann nicht geschweißt werden";
        }
        
        return classification; // Return original if no specific interpretation found
    }
}

// Global scraper instance
const scraper = new SiemensProductScraper();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/scrape', async (req, res) => {
    try {
        const { articleNumber } = req.body;
        
        if (!articleNumber) {
            return res.status(400).json({ 
                error: 'Artikelnummer ist erforderlich',
                status: 'error'
            });
        }

        console.log(`📦 Starte Scraping für Artikelnummer: ${articleNumber}`);
        
        const result = await scraper.scrapeProduct(articleNumber);
        
        console.log(`✅ Scraping abgeschlossen für: ${articleNumber}`);
        console.log(`📊 Status: ${result.Status}`);
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ API Fehler:', error);
        res.status(500).json({ 
            error: error.message,
            status: 'error',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'DB Produktvergleich API',
        browser: scraper.browser ? 'Bereit' : 'Nicht initialisiert',
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint to check page content for troubleshooting
app.get('/api/debug/:articleNumber', async (req, res) => {
    try {
        const { articleNumber } = req.params;
        const url = `https://www.mymobase.com/de/p/${articleNumber}`;
        
        console.log(`🔍 Debug-Request für: ${articleNumber}`);
        
        const browser = await scraper.initBrowser();
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        const debugInfo = await page.evaluate(() => {
            return {
                title: document.title,
                hasInitialData: !!window.initialData,
                initialDataKeys: window.initialData ? Object.keys(window.initialData) : [],
                productDataExists: !!(window.initialData && window.initialData['product/dataProduct']),
                tables: document.querySelectorAll('table').length,
                divs: document.querySelectorAll('div').length,
                url: window.location.href,
                bodyText: document.body.textContent.substring(0, 500) + '...'
            };
        });
        
        await page.close();
        
        res.json({
            success: true,
            articleNumber,
            url,
            debugInfo,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Debug-Fehler:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            articleNumber: req.params.articleNumber,
            timestamp: new Date().toISOString()
        });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Server wird heruntergefahren...');
    await scraper.closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Server wird beendet...');
    await scraper.closeBrowser();
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 DB Produktvergleich Tool Server gestartet!

📍 Server läuft auf: http://localhost:${PORT}
🌐 Frontend: http://localhost:${PORT}
🔧 API Health: http://localhost:${PORT}/api/health

📘 API Endpoints:
   POST /api/scrape - Web-Scraping für Artikelnummer
   GET  /api/health - Server Status
   
💡 Zum Stoppen: Ctrl+C drücken
    `);
});

module.exports = app;