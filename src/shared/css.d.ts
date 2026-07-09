declare module "*.css";
declare module "*.scss";
declare module "*.module.scss" {
  const classes: { [key: string]: string };
  export default classes;
}

declare module "hls.js/dist/hls.light.js" {
  import Hls from "hls.js";
  export default Hls;
}
