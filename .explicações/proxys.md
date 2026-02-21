## Fontes Externas (Coleta Automatica)

### 1. ProxyScrape (Gratuito)
```
URL: https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=br&proxy_format=protocolipport&format=json&timeout=20000&limit=50
```

**Exemplo de resposta:**
```json
{
  "proxies": [
    {
      "proxy": "http://189.1.172.74:3128",
      "timeout": 20000
    },
    {
      "proxy": "socks5://177.93.38.241:1080",
      "timeout": 20000
    }
  ]
}
```

---

### 2. Geonode (Gratuito)
```
URL: https://proxylist.geonode.com/api/proxy-list?country=BR&filterUpTime=90&filterLastChecked=30&speed=fast&limit=50&page=1&sort_by=lastChecked&sort_type=desc
```

**Exemplo de resposta:**
```json
{
  "data": [
    {
      "ip": "177.93.38.241",
      "port": "3128",
      "protocols": ["http", "https"],
      "country": "BR",
      "upTime": 95
    },
    {
      "ip": "189.1.172.74",
      "port": "8080",
      "protocols": ["http"],
      "country": "BR",
      "upTime": 88
    }
  ]
}
```

---

### 3. 911Proxy (Gratuito)
```
URL: https://www.911proxy.com/web_v1/free-proxy/list?page_size=60&page=1&country_code=BR
```

**Exemplo de resposta:**
```json
{
  "code": 200,
  "data": {
    "list": [
      {
        "ip": "177.93.38.241",
        "port": "3128",
        "protocol": 1,
        "status": 1
      }
    ]
  }
}
```

**Protocolo map:** `{ 1: 'https', 2: 'http', 4: 'socks4', 5: 'socks5' }`
