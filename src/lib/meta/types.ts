export interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export interface MetaApiResponse<T> {
  data?: T;
  error?: MetaApiError;
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

export interface MetaCatalogProduct {
  id: string;
  retailer_id: string;
  availability?: string;
  inventory?: number;
  name?: string;
  price?: string;
  url?: string;
  image_url?: string;
}

export interface MetaBatchItem {
  method: "CREATE" | "UPDATE" | "DELETE";
  retailer_id: string;
  data: MetaBatchItemData;
}

export interface MetaBatchItemData {
  availability?: "in stock" | "out of stock" | "preorder";
  inventory?: number;
  title?: string;  // Meta uses 'title' not 'name'
  description?: string;
  image_link?: string;
  link?: string;  // Meta uses 'link' not 'url'
  price?: string;
  brand?: string;
  condition?: "new" | "refurbished" | "used";
  currency?: string;
  // Multi-ratio images
  "image[0].url"?: string;
  "image[0].tag[0]"?: string;
  "image[1].url"?: string;
  "image[1].tag[0]"?: string;
  "image[2].url"?: string;
  "image[2].tag[0]"?: string;
  "image[2].tag[1]"?: string;
}

export interface MetaBatchResponse {
  handles?: string[];
  validation_status?: Array<{
    retailer_id: string;
    errors?: Array<{ message: string }>;
    warnings?: Array<{ message: string }>;
  }>;
  error?: MetaApiError;
}

export interface MetaBatchRequest {
  item_type: "PRODUCT_ITEM";
  requests: MetaBatchItem[];
}
