/** @type {import('./_venera_.js')} */
class ManWaBa extends ComicSource {
  name = "漫蛙吧";
  key = "manwaba";
  version = "1.0.7";
  minAppVersion = "1.4.0";
  url = "https://raw.githubusercontent.com/huangjun7hb/venera-next-sources/main/manwaba.js";
  api = "https://mwuu.cc/api";

  init() {
    this.fetchJson = async (url, { method = "GET", params, headers, payload } = {}) => {
      if (params) {
        const paramsStr = Object.keys(params)
          .filter((k) => params[k] !== undefined && params[k] !== null)
          .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
          .join("&");
        if (paramsStr) url += `${url.includes("?") ? "&" : "?"}${paramsStr}`;
      }
      const res = await Network.sendRequest(method, url, headers || {}, payload);
      if (res.status !== 200) throw new Error(`Invalid status code: ${res.status}`);
      return JSON.parse(res.body);
    };
  }

  imageHeaders = {
    "Referer": "https://mwuu.cc/",
    "Origin": "https://mwuu.cc",
    "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
  };

  decryptMhttuImage(buffer) {
    const src = new Uint8Array(buffer);
    if (src.length <= 16) return buffer;
    const isJpeg = src.length >= 2 && src[0] === 0xff && src[1] === 0xd8;
    const isPng = src.length >= 4 && src[0] === 0x89 && src[1] === 0x50 && src[2] === 0x4e && src[3] === 0x47;
    const isWebp = src.length >= 4 && src[0] === 0x52 && src[1] === 0x49 && src[2] === 0x46 && src[3] === 0x46;
    if (isJpeg || isPng || isWebp) return buffer;
    try {
      const key = Convert.encodeUtf8("0B6666A0-BB59-1381-B746-a0E4C9AC".substring(0, 32));
      const iv = src.slice(0, 16).buffer;
      const encrypted = src.slice(16).buffer;
      let decrypted = new Uint8Array(Convert.decryptAesCbc(encrypted, key, iv));
      if (decrypted.length > 0) {
        const pad = decrypted[decrypted.length - 1];
        if (pad >= 1 && pad <= 16 && pad <= decrypted.length) {
          let valid = true;
          for (let i = decrypted.length - pad; i < decrypted.length; i++) {
            if (decrypted[i] !== pad) { valid = false; break; }
          }
          if (valid) decrypted = decrypted.slice(0, decrypted.length - pad);
        }
      }
      return decrypted.buffer;
    } catch (_) {
      return buffer;
    }
  }

  buildImageConfig(url) {
    const cfg = { url, headers: this.imageHeaders };
    if (String(url).includes("mhttu.cc")) cfg.onResponse = (buffer) => this.decryptMhttuImage(buffer);
    return cfg;
  }

  // Use the site image host for cover paths reported by older CDN URLs.
  // This applies only to covers; working chapter-image requests stay unchanged.
  normalizeCoverUrl(rawUrl) {
    let url = String(rawUrl || "").trim();
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/")) url = "https://mwuu.cc" + url;
    else if (/^http:\/\//i.test(url)) url = url.replace(/^http:/i, "https:");
    // Mirror the /en_images/ cover path on the site's image host.
    return url.replace(
      /^https:\/\/(?:ce\.mwzu\.cc|mwtuyi\.cc|tu\.mhttu\.cc)(\/en_images\/[^?#]+(?:[?#].*)?)$/i,
      "https://tu.mwzu.cc$1"
    );
  }

  isImageBytes(bytes) {
    if (bytes.length < 8) return false;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
    // AVIF/HEIF start with ISO-BMFF ftyp instead of JPEG/WebP magic.
    if (bytes.length >= 16 && bytes[4] === 0x66 && bytes[5] === 0x74 &&
        bytes[6] === 0x79 && bytes[7] === 0x70) return true;
    return false;
  }

  decodeThumbnail(buffer) {
    const input = new Uint8Array(buffer);
    if (this.isImageBytes(input)) return buffer;
    if (input.length < 32 || (input.length - 16) % 16 !== 0) {
      throw new Error("漫蛙封面响应不是图片或AES密文：长度=" + input.length);
    }
    const decoded = this.decryptMhttuImage(buffer);
    if (!this.isImageBytes(new Uint8Array(decoded))) {
      // Throw before Venera caches invalid data as a valid cover.
      throw new Error("漫蛙封面解密后不是图片；请检查图床域名或缓存。");
    }
    return decoded;
  }

  buildThumbnailConfig(rawUrl) {
    return {
      url: this.normalizeCoverUrl(rawUrl),
      headers: {
        "Referer": "https://mwuu.cc/",
        "User-Agent": this.imageHeaders["User-Agent"],
        "Accept": this.imageHeaders["Accept"],
      },
      onResponse: (buffer) => this.decodeThumbnail(buffer),
    };
  }

  parseComic = (comic) => new Comic({
    id: (comic.id ?? String(comic.url || "").split("/").pop()).toString(),
    title: comic.title || "",
    subTitle: comic.author || "",
    cover: this.normalizeCoverUrl(comic.pic || comic.cover || comic.image || ""),
    tags: String(comic.tags || "").split(",").filter(Boolean),
    description: comic.intro || comic.description || "",
    status: comic.status == 0 ? "连载中" : "已完结",
  });

  explore = [{
    title: this.name,
    type: "singlePageWithMultiPart",
    load: async () => {
      const data = (await this.fetchJson(`${this.api}/home`, {
        params: { page: 1, pageSize: 6, type: "", flag: false },
      })).data;
      const parts = {
        热门: data.comicList || [],
        最新完整版: data.gufengList || [],
        最新更新: data.xuanhuanList || [],
        热门收藏: data.xiaoyuanList || [],
      };
      const result = {};
      for (const k of Object.keys(parts)) result[k] = parts[k].map(this.parseComic);
      return result;
    },
  }];

  category = {
    title: this.name,
    parts: [{
      name: "类型",
      type: "fixed",
      categories: ["全部","热血","玄幻","恋爱","冒险","古风","都市","穿越","奇幻","其他","搞笑","少男","战斗","重生","逆袭","爆笑","少年","后宫","系统","BL","韩漫","完整版","19r","台版"],
      itemType: "category",
      categoryParams: ["","热血","玄幻","恋爱","冒险","古风","都市","穿越","奇幻","其他","搞笑","少男","战斗","重生","逆袭","爆笑","少年","后宫","系统","BL","韩漫","完整版","19r","台版"],
    }],
    enableRankingPage: false,
  };

  categoryComics = {
    load: async (category, param, options, page) => {
      const pathMap = {
        "": "/cate", "热血": "/cate/hotblooded", "玄幻": "/cate/xuanhuan", "恋爱": "/cate/romance",
        "冒险": "/cate/adventure", "古风": "/cate/historical", "都市": "/cate/urban", "穿越": "/cate/transmigration",
        "奇幻": "/cate/fantasy", "搞笑": "/cate/comedy", "少男": "/cate/shounen", "战斗": "/cate/action",
        "重生": "/cate/rebirth", "逆袭": "/cate/counterattack", "爆笑": "/cate/hilarious", "少年": "/cate/youth",
        "系统": "/cate/system", "BL": "/cate/bl", "韩漫": "/cate/manhwa", "完整版": "/cate/fullversion",
        "19r": "/cate/19plus", "台版": "/cate/taiwanver",
      };
      const safeOptions = options || ["2", "0", "0"];
      const payload = JSON.stringify({
        page: { page, pageSize: 10 },
        category: "comic",
        sort: parseInt(safeOptions[2] || "0"),
        comic: {
          status: parseInt((safeOptions[0] || "2") === "2" ? -1 : safeOptions[0]),
          day: parseInt(safeOptions[1] || "0"),
          tag: param || "",
        },
        video: { year: 0, typeId: 0, typeId1: 0, area: "", lang: "", status: -1, day: 0 },
        novel: { status: -1, day: 0, sortId: 0 },
      });
      const res = await this.fetchJson(this.api + (pathMap[param || ""] || "/cate"), {
        method: "POST", headers: { "Content-Type": "application/json" }, payload,
      });
      const list = res.data?.list || [];
      return { comics: list.map(this.parseComic), maxPage: 100 };
    },
    optionList: [
      { options: ["2-全部", "0-连载中", "1-已完结"] },
      { options: ["0-全部", "1-周一", "2-周二", "3-周三", "4-周四", "5-周五", "6-周六", "7-周日"] },
      { options: ["0-更新", "1-新作", "2-畅销", "3-热门", "4-收藏"] },
    ],
  };

  search = {
    load: async (keyword, options, page) => {
      const pageSize = 20;
      const data = (await this.fetchJson(`${this.api}/search`, {
        params: { keyword, type: "mh", page, pageSize },
      })).data || {};
      return {
        comics: (data.list || []).map(this.parseComic),
        maxPage: Math.ceil((data.total || 0) / pageSize),
      };
    },
  };

  comic = {
    onThumbnailLoad: (url) => this.buildThumbnailConfig(url),

    loadInfo: async (id) => {
      const data = (await this.fetchJson(`${this.api}/comic/${id}`)).data;
      const params = { comicId: data.id, page: 1, pageSize: 1 };
      const first = await this.fetchJson(`${this.api}/comic/chapter`, { params });
      const total = first.pagination?.total ?? first.data?.pagination?.total ?? 1;
      const all = await this.fetchJson(`${this.api}/comic/chapter`, {
        params: { ...params, pageSize: total },
      });
      const chapterList = all.data?.list || all.data || [];
      const chapters = new Map();
      for (const item of chapterList) {
        if (item && item.id != null) chapters.set(item.id.toString(), String(item.title || item.name || item.id));
      }
      return new ComicDetails({
        title: String(data.title || ""),
        subTitle: String(data.author || ""),
        cover: this.normalizeCoverUrl(data.cover || data.pic || data.image || ""),
        tags: {
          类型: String(data.tags || "").split(",").filter(Boolean),
          状态: [data.status == 0 ? "连载中" : "已完结"],
        },
        chapters,
        description: data.intro || "",
        updateTime: data.editTime ? new Date(data.editTime * 1000).toLocaleDateString() : "",
      });
    },

    loadEp: async (comicId, epId) => {
      const imgApi = `${this.api}/comic/image/${epId}`;
      // Backend expects snake_case; camelCase silently returns its default page.
      const pageSize = 100;
      const baseParams = { page_size: pageSize, image_source: "https://tu.mhttu.cc" };
      const first = await this.fetchJson(imgApi, { params: { ...baseParams, page: 1 } });
      const firstData = first.data || first;
      const firstPage = firstData.images || [];
      const pagination = firstData.pagination || first.pagination || {};
      const total = Number(pagination.total);
      if (!Array.isArray(firstPage) || firstPage.length === 0 ||
          !Number.isSafeInteger(total) || total < firstPage.length) {
        throw new Error("漫蛙章节图片数量异常，请提供日志检查分页接口。");
      }
      // A mirror may cap the effective page size below the requested limit.
      const declaredSize = Number(pagination.size);
      const effectiveSize = Math.min(
        firstPage.length,
        Number.isSafeInteger(declaredSize) && declaredSize > 0 ? declaredSize : pageSize,
      );
      const maxPages = Math.ceil(total / effectiveSize);
      if (maxPages > 120) throw new Error("漫蛙章节图片分页异常：页数过多。");
      const images = [];
      const seen = new Set();
      const append = (list) => {
        if (!Array.isArray(list) || list.length === 0) {
          throw new Error("漫蛙章节分页返回空图片列表。");
        }
        for (const item of list) {
          const url = typeof item === "string" ? item : (item?.url || item?.pic || item?.image);
          if (typeof url !== "string" || !url.trim() || seen.has(url)) {
            throw new Error("漫蛙章节分页存在无效或重复图片。");
          }
          seen.add(url);
          images.push(url);
        }
      };
      append(firstPage);
      for (let page = 2; images.length < total && page <= maxPages; page++) {
        const res = await this.fetchJson(imgApi, { params: { ...baseParams, page } });
        append((res.data || res).images || []);
      }
      if (images.length !== total) {
        throw new Error(`漫蛙章节图片不完整：获取到 ${images.length}/${total} 张，请检查分页接口。`);
      }
      return { images };
    },

    onImageLoad: (url) => this.buildImageConfig(url),
  };
}
