// Shared types and utilities
export interface WCImage {
  id: number;
  src: string;
}

export interface WCProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: string;
  status: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  date_on_sale_from: string | null;
  date_on_sale_to: string | null;
  stock_status: string;
  stock_quantity: number | null;
  images: WCImage[];
  attributes: any[];
  variations: number[];
  parent_id: number;
  categories: { id: number; name: string }[];
}

export interface MetaProduct {
  id: string;
  title: string;
  description: string;
  rich_text_description?: string;
  availability: "in stock" | "out of stock" | "preorder";
  condition: "new" | "refurbished" | "used";
  price: string;
  link: string;
  image_link: string;
  brand: string;
  additional_image_link?: string;
  age_group?: string;
  color?: string;
  gender?: string;
  item_group_id?: string;
  google_product_category?: string;
  product_type?: string;
  sale_price?: string;
  sale_price_effective_date?: string;
  size?: string;
  status: "active" | "archived";
  inventory?: number;
}

