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

export interface MetaImage {
  url: string;
  tag: string[];
}

export interface MetaBatchItemData {
  availability?: "in stock" | "out of stock" | "preorder";
  inventory?: number;
  title?: string;  // Meta uses 'title' not 'name'
  description?: string;
  image_link?: string;  // Main image (use this OR image array, not both)
  link?: string;  // Meta uses 'link' not 'url'
  price?: string;  // Price includes currency (e.g., "10.00 BAM")
  sale_price?: string;  // Sale price with currency, empty string to clear
  brand?: string;
  condition?: "new" | "refurbished" | "used";
  item_group_id?: string;  // Groups variants together
  size?: string;
  color?: string;
  product_type?: string;  // Category hierarchy (e.g., "Clothing > Shirts > T-Shirts")
  google_product_category?: string;  // Google product taxonomy
  // Multi-ratio images array (use this OR image_link, not both)
  image?: MetaImage[];
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
