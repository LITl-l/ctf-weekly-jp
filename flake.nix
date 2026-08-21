{
  description = "ctf-weekly-jp — weekly CTFtime digest for Discord (Cloudflare Workers)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 ];
          shellHook = ''
            echo "ctf-weekly-jp — node $(node -v)"
            echo "  npm install && npm test"
            echo "  npm run dryrun   # live CTFtime fetch, no secrets needed"
          '';
        };
      });
    };
}
