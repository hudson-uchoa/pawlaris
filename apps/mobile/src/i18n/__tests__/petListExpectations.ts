// Independent transcription of 09 §4.2.1; do not derive from the implementation.
export const expectedPetLists = {
  breeds: {
    cat: {
      srd: 'SRD (sem raça definida)', siamese: 'Siamês', persian: 'Persa',
      maine_coon: 'Maine Coon', angora: 'Angorá', ragdoll: 'Ragdoll', bengal: 'Bengal',
      british_shorthair: 'British Shorthair', exotic: 'Exótico', himalayan: 'Himalaio',
      russian_blue: 'Azul Russo', birman: 'Sagrado da Birmânia', scottish_fold: 'Scottish Fold',
      sphynx: 'Sphynx', abyssinian: 'Abissínio', chartreux: 'Chartreux', bombay: 'Bombaim',
    },
    dog: {
      srd: 'SRD (sem raça definida)', shih_tzu: 'Shih Tzu', yorkshire: 'Yorkshire',
      poodle: 'Poodle', lhasa_apso: 'Lhasa Apso', pomeranian: 'Spitz Alemão (Lulu da Pomerânia)',
      golden_retriever: 'Golden Retriever', labrador: 'Labrador', french_bulldog: 'Buldogue Francês',
      english_bulldog: 'Buldogue Inglês', pug: 'Pug', dachshund: 'Dachshund', pinscher: 'Pinscher',
      maltese: 'Maltês', beagle: 'Beagle', chihuahua: 'Chihuahua', schnauzer: 'Schnauzer',
      border_collie: 'Border Collie', german_shepherd: 'Pastor Alemão', belgian_shepherd: 'Pastor Belga',
      rottweiler: 'Rottweiler', pit_bull: 'Pit Bull', siberian_husky: 'Husky Siberiano', boxer: 'Boxer',
      cocker_spaniel: 'Cocker Spaniel', akita: 'Akita', chow_chow: 'Chow Chow', dobermann: 'Dobermann',
      jack_russell: 'Jack Russell', dalmatian: 'Dálmata',
      brazilian_terrier: 'Terrier Brasileiro (Fox Paulistinha)', fila: 'Fila Brasileiro',
    },
  },
  coats: {
    cat: {
      black: 'Preto', white: 'Branco', gray: 'Cinza', orange: 'Laranja', cream: 'Creme',
      tabby: 'Rajado', tuxedo: 'Frajola (preto e branco)', tortoiseshell: 'Escaminha',
      calico: 'Tricolor', colorpoint: 'Siamês (colorpoint)',
    },
    dog: {
      black: 'Preto', white: 'Branco', brown: 'Marrom', caramel: 'Caramelo', golden: 'Dourado',
      cream: 'Creme', gray: 'Cinza', brindle: 'Tigrado', black_white: 'Preto e branco',
      tricolor: 'Tricolor', merle: 'Merle',
    },
  },
} as const;

export const expectedOtherLabel = 'Outra…';
