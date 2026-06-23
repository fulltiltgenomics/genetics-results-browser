import { useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  CircularProgress,
  Divider,
  FormControlLabel,
  Link,
  Switch,
  TextField,
  Typography,
  debounce,
} from "@mui/material";
import Button from "@mui/material/Button";
import CreateIcon from "@mui/icons-material/Create";
import { useDataStore } from "../../store/store";
import { usePhenoFilterStore } from "../../store/store.phenoFilter";
import { usePhenotypeSearch } from "../../store/serverQuery";
import { HIDDEN_RESOURCES } from "../../store/munge.normalized";
import { PhenotypeSearchHit } from "../../types/types.normalized";
import { formatPhenotypeCounts } from "../table/utils/tableutil";
import config from "../../config.json";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useNavigate, useSearchParams } from "react-router-dom";

const InputForm = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formValues, setFormValues] = useState({ variantInput: "" });
  const setVariantInput = useDataStore((state) => state.setVariantInput);
  const setMessage = useDataStore((state) => state.setMessage);
  const navigate = useNavigate();

  // phenotype-search entry point: debounced /search autocomplete; picking a phenotype annotates its
  // credible-set lead variants (with the data's betas) via the "pheno:{resource}:{code}" token.
  const [phenoInput, setPhenoInput] = useState("");
  const [phenoQuery, setPhenoQuery] = useState("");
  const setPhenoQueryDebounced = useMemo(
    () => debounce((value: string) => setPhenoQuery(value), 300),
    []
  );
  // the annotation search needs phenotypes with CREDIBLE SETS (it annotates their lead variants), not
  // summary stats — so it must include e.g. Open Targets, which has credible sets but no full sumstats.
  const { data: phenoHitsRaw = [], isFetching: phenoFetching } = usePhenotypeSearch(phenoQuery, {
    requireCredibleSets: true,
  });
  // persisted toggle: when on, restrict results to FinnGen-resource phenotypes.
  const onlyFinnGen = usePhenoFilterStore((state) => state.onlyFinnGen);
  const setOnlyFinnGen = usePhenoFilterStore((state) => state.setOnlyFinnGen);
  // drop resources temporarily hidden from the frontend (see HIDDEN_RESOURCES) so they can't be searched.
  const phenoHits = useMemo(
    () =>
      phenoHitsRaw.filter(
        (h) => !HIDDEN_RESOURCES.has(h.resource) && (!onlyFinnGen || h.resource === "finngen")
      ),
    [phenoHitsRaw, onlyFinnGen]
  );

  // form has been submitted or the url has been changed
  useEffect(() => {
    if (searchParams.get("q")) {
      const input = decompressFromEncodedURIComponent(searchParams.get("q")!);
      setFormValues({
        variantInput: input,
      });
      setVariantInput(input);
      setMessage(undefined);
    }
  }, [searchParams]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormValues({
      ...formValues,
      [name]: value,
    });
  };

  const handleSubmit = (input: string) => {
    const lz = compressToEncodedURIComponent(input);
    // 2000 is the limit for url length in many browsers, but we need some space for the rest of the url
    if (lz.length > 1900) {
      setFormValues({
        variantInput: input,
      });
      setVariantInput(input);
      setMessage(
        "The input is too long to be stored in the url. If you want to share these results, you should share your variant list instead of a direct link."
      );
      // the annotation tool now lives at /annotate (refactor.md §3); keep the query on the current route
      navigate("/annotate");
    } else {
      navigate("/annotate?q=" + lz);
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit(formValues.variantInput);
  };

  const setExampleData = (data: string) => {
    let input = "";
    if (data == "FinnGen_priority") {
      input = "FinnGen_enriched_202505";
    }
    handleSubmit(input);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: "24px",
        alignItems: "flex-start",
        marginBottom: "10px",
      }}>
      <form onSubmit={handleFormSubmit}>
        <Box sx={{ display: "flex", flexDirection: "column", width: "360px" }}>
          <TextField
            sx={{ marginBottom: "10px" }}
            id="filled-multiline-flexible"
            name="variantInput"
            label="Paste GRCh38 variant ids or rsids, or enter a gene name"
            value={formValues.variantInput}
            multiline
            rows={10}
            variant="outlined"
            onChange={handleInputChange}
          />
          <Button
            size="small"
            startIcon={<CreateIcon />}
            variant="contained"
            type="submit">
            <span>annotate</span>
          </Button>
        </Box>
      </form>

      <Box sx={{ width: "440px", display: "flex", flexDirection: "column" }}>
        <Divider sx={{ marginBottom: "10px" }}>or</Divider>
        <Autocomplete<PhenotypeSearchHit>
          options={phenoHits}
          loading={phenoFetching}
          filterOptions={(x) => x}
          getOptionLabel={(o) => `${o.name} (${o.code})`}
          isOptionEqualToValue={(a, b) => a.resource === b.resource && a.code === b.code}
          inputValue={phenoInput}
          onInputChange={(_e, value) => {
            setPhenoInput(value);
            setPhenoQueryDebounced(value);
          }}
          onChange={(_e, value) => {
            if (value) {
              handleSubmit(`pheno:${value.resource}:${value.code}`);
            }
          }}
          renderOption={(props, option) => {
            const counts = formatPhenotypeCounts(option);
            return (
              <li {...props} key={`${option.resource}|${option.code}`}>
                <Box>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.code} · {option.resource} · {option.dataType}
                    {counts ? ` · ${counts}` : ""}
                  </Typography>
                </Box>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search for a phenotype to annotate its credible set lead variants"
              placeholder="e.g. alzheimer, asthma"
              size="small"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {phenoFetching ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <FormControlLabel
          sx={{ mt: 0.5 }}
          control={
            <Switch
              size="small"
              checked={onlyFinnGen}
              onChange={(e) => setOnlyFinnGen(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              only FinnGen phenotypes
            </Typography>
          }
        />
      </Box>

      <Box sx={{ maxWidth: "420px", display: "flex", flexDirection: "column" }}>
        <Divider sx={{ marginBottom: "10px" }}>or</Divider>
        <Typography>
          <Link
            sx={{ cursor: "pointer" }}
            onClick={() => {
              setExampleData("FinnGen_priority");
            }}>
            888 Finnish-enriched variants (genome-wide significant in FinnGen R12 core analysis,
            LD-pruned, &gt; 5x enriched, &lt; 1 % AF in non-Finnish Europeans)
          </Link>
        </Typography>
      </Box>
    </Box>
  );
};

export default InputForm;
