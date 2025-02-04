// Copyright (c) 2025 Stu Eggerton. All rights reserved.
// See LICENSE.md for license details.

const express = require('express');
const { Liquid } = require('liquidjs');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const config = require('./config.json');
const toml = require('toml');

const app = express();
const port = 3000;

// Setup Liquid Engine
const engine = new Liquid({
    root: path.join(__dirname),
    extname: '.html'
});

app.engine('html', engine.express());
app.set('view engine', 'html');

// Set the views directory to the root directory
app.set('views', __dirname);

// Serve static files
app.use(express.static('public'));
app.use('/design-system', express.static('design-system'));
app.use('/fonts', express.static('design-system/fonts'));  // Serve fonts at /fonts
app.use('/images', express.static(path.join(__dirname, config.designSystem.imagesPath)));

// Load sample data
async function loadSampleData() {
    const eplFixtures = JSON.parse(await fs.readFile('./epl-fixtures/sample.json', 'utf8'));
    const eplMyTeam = JSON.parse(await fs.readFile('./epl-my-team/sample.json', 'utf8'));
    return { eplFixtures, eplMyTeam };
}

// Update the getAvailablePlugins function to read from config.toml
async function getAvailablePlugins() {
    const dirs = (await fs.readdir(__dirname, { withFileTypes: true }))
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => 
            !['node_modules', 'public', 'design-system', 'scripts'].includes(name) && 
            !name.startsWith('.')
        );

    // Add the "All" option as the first plugin
    const plugins = [{
        id: 'all',
        name: 'All Plugins'
    }];

    // Get plugin info for each directory
    const pluginInfos = await Promise.all(
        dirs.map(async (dir) => {
            try {
                const configContent = await fs.readFile(path.join(__dirname, dir, 'config.toml'), 'utf8');
                const pluginInfo = toml.parse(configContent);
                return {
                    id: dir,
                    name: pluginInfo.name,
                    public_url: pluginInfo.url
                };
            } catch (error) {
                console.warn(`Warning: No config.toml found for ${dir}`);
                return null;
            }
        })
    );

    // Add the valid plugins after the "All" option
    plugins.push(...pluginInfos.filter(plugin => plugin !== null));
    return plugins;
}

// Add this new endpoint
app.get('/api/plugins', async (req, res) => {
    const plugins = await getAvailablePlugins();
    res.json(plugins);
});

// Update the root route to handle rendering all plugins
app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Simplify the fetchLiveData function
async function fetchLiveData(url, headers) {
    try {
        let parsedHeaders = {};
        if (headers) {
            try {
                parsedHeaders = typeof headers === 'string' ? JSON.parse(headers) : headers;
            } catch (error) {
                console.error('Error parsing headers:', error);
            }
        }

        const response = await fetch(url, { headers: parsedHeaders });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching live data:', error);
        throw error;
    }
}

// Update the preview route to use config.toml
app.get('/preview/:plugin/:layout', async (req, res) => {
    const { plugin, layout } = req.params;
    const { live } = req.query;
    
    try {
        let data;
        if (live === 'true') {
            const configContent = await fs.readFile(path.join(__dirname, plugin, 'config.toml'), 'utf8');
            const pluginInfo = toml.parse(configContent);

            let envVars = {};
            try {
                const env = await fs.readFile(path.join(__dirname, plugin, '.env'), 'utf8');
                envVars = env.split('\n').reduce((acc, line) => {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        acc[key.trim()] = value.trim();
                    }
                    return acc;
                }, {});
            } catch (err) {
                console.warn(`Warning: No .env file found for plugin ${plugin}`);
            }

            let publicUrl = pluginInfo.url;
            if (envVars.additional_query_string_params) {
                publicUrl += `&${envVars.additional_query_string_params}`;
            }

            const headers = JSON.parse(envVars.HEADERS || '{}');
            data = await fetchLiveData(publicUrl, headers);
        } else {
            data = JSON.parse(
                await fs.readFile(`./${plugin}/sample.json`, 'utf8')
            );
        }

        const viewPath = path.join(plugin, 'views', layout.replace('-', '_') + '.liquid');
        const templateContent = await engine.renderFile(viewPath, data);
        
        const fontFaces = `
            @font-face {
                font-family: 'NicoClean';
                src: url('${config.designSystem.fonts.path}/NicoClean-Regular.ttf') format('truetype');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }
            @font-face {
                font-family: 'NicoBold';
                src: url('${config.designSystem.fonts.path}/NicoBold-Regular.ttf') format('truetype');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }
            @font-face {
                font-family: 'NicoPups';
                src: url('${config.designSystem.fonts.path}/NicoPups-Regular.ttf') format('truetype');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }
            @font-face {
                font-family: 'BlockKie';
                src: url('${config.designSystem.fonts.path}/BlockKie.ttf') format('truetype');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
            }
            /* Include Inter font */
            @import url('${config.designSystem.fonts.path}/inter.css');
        `;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>${fontFaces}</style>
                <link rel="stylesheet" href="${config.designSystem.cssPath}">
                <link rel="stylesheet" href="/custom.css">
            </head>
            <body class="trmnl view-only" style="padding:0;margin:0;background:white;">
                ${templateContent}
                <script src="${config.designSystem.jsPath}"></script>
                <script>
                    window.addEventListener('load', function() {
                        if (typeof terminalize === 'function') {
                            terminalize();
                        }
                    });
                </script>
            </body>
            </html>
        `;
        res.send(htmlContent);
    } catch (error) {
        console.error('Error rendering template:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// Update the layout endpoint to handle the .liquid extension
app.get('/api/layout/:pluginId/:layout', async (req, res) => {
    try {
        const layoutName = req.params.layout.replace('.html', '').replace('-', '_');
        const layoutContent = await fs.readFile(
            path.join(__dirname, req.params.pluginId, `${layoutName}.liquid`),
            'utf8'
        );
        res.send(layoutContent);
    } catch (error) {
        console.error('Error reading layout template:', error);
        res.status(404).json({ error: 'Layout template not found' });
    }
});

// Update the endpoint to serve the raw config.toml content
app.get('/api/plugin-toml/:pluginId', async (req, res) => {
    try {
        const pluginId = req.params.pluginId;
        const configPath = path.join(__dirname, pluginId, 'config.toml');
        const configContent = await fs.readFile(configPath, 'utf8');
        // Send the raw TOML content with text/plain content type
        res.type('text/plain').send(configContent);
    } catch (error) {
        console.error(`Error reading config.toml for plugin ${req.params.pluginId}:`, error);
        res.status(404).json({ error: 'Plugin configuration not found' });
    }
});

app.listen(port, () => {
    console.log(`Test app running at http://localhost:${port}`);
}); 