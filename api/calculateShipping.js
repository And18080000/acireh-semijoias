const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

// Esta função permite que o seu site aceda a este endpoint de forma segura (CORS)
const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permite qualquer origem
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

const handler = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    const { originCep, destinationCep, items } = req.body;

    if (!originCep || !destinationCep || !items || items.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para o cálculo do frete.' });
    }

    let totalWeight = 0;
    let totalVolume = 0;
    let maxLength = 0;

    items.forEach(item => {
        const quantity = item.quantity || 1;
        totalWeight += (item.weight || 0.1) * quantity;
        totalVolume += (item.length || 11) * (item.width || 11) * (item.height || 2) * quantity;
        maxLength = Math.max(maxLength, item.length || 11, item.width || 11, item.height || 2);
    });

    if (totalWeight < 0.3) {
        totalWeight = 0.3;
    }

    const cubeSide = Math.cbrt(totalVolume);
    const finalLength = Math.max(15, maxLength, cubeSide);
    const finalWidth = Math.max(10, cubeSide);
    const finalHeight = Math.max(1, cubeSide);

    const correiosApiUrl = "http://ws.correios.com.br/calculador/CalcPrecoPrazo.aspx";
    const params = new URLSearchParams({
        nCdEmpresa: "",
        sDsSenha: "",
        nCdServico: "04510,04014", // PAC e SEDEX
        sCepOrigem: originCep.replace(/\D/g, ""),
        sCepDestino: destinationCep.replace(/\D/g, ""),
        nVlPeso: totalWeight.toString(),
        nCdFormato: "1",
        nVlComprimento: finalLength.toString(),
        nVlAltura: finalHeight.toString(),
        nVlLargura: finalWidth.toString(),
        nVlDiametro: "0",
        sCdMaoPropria: "N",
        nVlValorDeclarado: "0",
        sCdAvisoRecebimento: "N",
        output: "xml",
    });

    try {
        const correiosResponse = await fetch(`${correiosApiUrl}?${params.toString()}`);
        const xmlText = await correiosResponse.text();
        const result = await parseStringPromise(xmlText);

        const services = result.Servicos.cServico;
        const shippingOptions = services.map(service => ({
            code: service.Codigo[0],
            name: service.Codigo[0] === "04510" ? "PAC" : "SEDEX",
            price: parseFloat(service.Valor[0].replace(",", ".")),
            deadline: parseInt(service.PrazoEntrega[0], 10),
            error: service.Erro[0] !== "0" ? service.MsgErro[0] : null,
        }));

        res.status(200).json(shippingOptions);

    } catch (error) {
        console.error("Erro ao calcular frete:", error);
        res.status(500).json({ error: "Erro ao comunicar com os Correios." });
    }
};

module.exports = allowCors(handler);
